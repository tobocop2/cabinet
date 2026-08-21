import { NextResponse } from "next/server";
import { MCP_CATALOG } from "@/lib/agents/mcp-catalog";
import { connectedProvidersForEntry } from "@/lib/agents/mcp-config-writer";
import { readCabinetEnvFile } from "@/lib/runtime/cabinet-env";
import { isCloud } from "@/lib/cloud/tier";
import {
  memoryKey,
  readDetail,
  readReady,
  reduceProbe,
  probeTargets,
  shortenDetail,
  type IntegrationStatus,
  type ProbeMemory,
  type ProbeTarget,
} from "@/lib/integrations/status-probe";

// Live state, never a build-time snapshot.
export const dynamic = "force-dynamic";

// The status bar polls this while visible, and several clients can be open,
// so one short shared result covers them all.
const TTL_MS = 5_000;
const PROBE_TIMEOUT_MS = 2_500;

let cached: { body: IntegrationStatus[]; expiresAt: number } | null = null;
let inflight: Promise<IntegrationStatus[]> | null = null;
/** Per-target memory, so a busy server does not flip a pill red. */
const memory = new Map<string, ProbeMemory>();

async function getJson(url: string, token?: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    // A health endpoint that redirects is not a health endpoint.
    redirect: "manual",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function readTarget(target: ProbeTarget, now: number): Promise<IntegrationStatus> {
  let reachable = false;
  let ready: boolean | undefined;
  let detailKnown = false;
  let detail: string | undefined;
  try {
    const health = await getJson(target.url, target.token);
    reachable = true;
    ready = readReady(health, target.readyField);
  } catch {
    reachable = false; // unreachable, refused, or slower than the timeout
  }
  // The detail costs a second request, so ask only while the server answers.
  if (reachable && target.detailUrl) {
    try {
      const body = await getJson(target.detailUrl, target.token);
      const raw = readDetail(body, target.detailField);
      detail = raw ? shortenDetail(raw) : undefined;
      detailKnown = true;
    } catch {
      detailKnown = false; // reduceProbe keeps the last known detail
    }
  }
  const key = memoryKey(target);
  const next = reduceProbe(memory.get(key), { reachable, ready, detailKnown, detail }, now);
  memory.set(key, next);
  return { id: target.id, label: target.label, state: next.state, detail: next.detail };
}

async function probeAll(): Promise<IntegrationStatus[]> {
  // A probe is a server-side fetch of a URL the user typed, carrying that
  // integration's bearer token. On the desk that is exactly right — it is the
  // user's own machine reaching their own server. In a hosted container it is
  // a request the tenant can aim anywhere the container can reach, so cloud
  // gets no pills.
  if (isCloud()) return [];
  const values = readCabinetEnvFile().values;
  const targets = probeTargets(
    MCP_CATALOG,
    (entry) => connectedProvidersForEntry(entry).length > 0,
    values,
  );
  // Drop memory for targets that are gone, so a disconnect or a repointed URL
  // starts clean rather than inheriting the old server's state.
  const live = new Set(targets.map(memoryKey));
  for (const key of memory.keys()) {
    if (!live.has(key)) memory.delete(key);
  }
  const now = Date.now();
  return Promise.all(targets.map((target) => readTarget(target, now)));
}

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ integrations: cached.body }, NO_STORE);
  }
  if (!inflight) {
    inflight = probeAll().finally(() => {
      inflight = null;
    });
  }
  let body: IntegrationStatus[];
  try {
    body = await inflight;
  } catch {
    // Reading the env file or the MCP config can throw on a corrupt file.
    // Serve the last good answer rather than a 500 the pill swallows, and let
    // the next tick retry.
    return NextResponse.json({ integrations: cached?.body ?? [] }, NO_STORE);
  }
  cached = { body, expiresAt: Date.now() + TTL_MS };
  return NextResponse.json({ integrations: body }, NO_STORE);
}
