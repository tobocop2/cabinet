/**
 * How to ask a connected integration's own server whether it is healthy.
 *
 * Declared per catalog entry rather than coded per vendor: the status bar
 * shows a pill for any entry that declares a probe, so adding one is a data
 * change (PROVIDER-CLI §13 — switch on a trait, not on an id).
 */
export interface StatusProbe {
  /** `.cabinet.env` key holding the server's base URL. Its origin is used. */
  urlEnv: string;
  /** `.cabinet.env` key holding a bearer token, when the server needs one. */
  tokenEnv?: string;
  /** Cheap liveness endpoint, e.g. `/api/health`. */
  path: string;
  /**
   * Dotted path to a boolean in the liveness body that reports whether the
   * server can actually do work yet. A model server that is up but still
   * loading answers `false` here, which reads as `notReady` rather than a
   * green pill over a server that cannot serve a request.
   */
  readyField?: string;
  /** Second endpoint carrying the detail worth showing, e.g. `/api/models`. */
  detailPath?: string;
  /** Dotted path into the detail body, e.g. `chat.active`. */
  detailField?: string;
}

/**
 * The part of a catalog entry a probe needs.
 *
 * Structural on purpose: this module stays standalone, so the catalog imports
 * `StatusProbe` without this module importing the catalog back.
 */
export interface ProbeableEntry {
  id: string;
  label: string;
  statusProbe?: StatusProbe;
}

export interface ProbeTarget {
  id: string;
  label: string;
  url: string;
  detailUrl?: string;
  token?: string;
  readyField?: string;
  detailField?: string;
}

export type PillState = "online" | "notReady" | "offline";

export interface IntegrationStatus {
  id: string;
  label: string;
  state: PillState;
  /** Short, already-shortened text for the pill (e.g. a model name). */
  detail?: string;
}

/**
 * How long a pill keeps reporting its last good state while probes fail.
 *
 * Servers that serialize requests — a single-slot model server is the common
 * case — stall a health check behind whatever they are streaming, so one
 * timeout means "busy" at least as often as "down".
 *
 * This is a duration and not a count of failures on purpose. A count is only
 * a duration if probes arrive on a fixed cadence, and they do not: the route
 * probes on a cache miss, so two clients polling out of phase burn a
 * failure-count twice as fast as one, and a tab that was hidden for an hour
 * arrives with a count of zero and would hold an hour-old green pill.
 */
export const STATE_HOLD_MS = 45_000;

/** Longest detail text a pill will show before it is truncated. */
const DETAIL_MAX_CHARS = 40;

/**
 * Build the list of servers to poll: connected entries that declare a probe
 * and whose URL is actually configured. A declared-but-unconfigured probe is
 * skipped rather than reported down — nothing is wrong, it is just not set up.
 */
export function probeTargets<E extends ProbeableEntry>(
  entries: readonly E[],
  isConnected: (entry: E) => boolean,
  values: Record<string, string>,
): ProbeTarget[] {
  const out: ProbeTarget[] = [];
  for (const entry of entries) {
    const probe = entry.statusProbe;
    if (!probe || !isConnected(entry)) continue;
    const raw = values[probe.urlEnv];
    if (!raw) continue;
    let origin: string;
    try {
      origin = new URL(raw).origin;
    } catch {
      continue; // a malformed URL is a config problem, not a health signal
    }
    out.push({
      id: entry.id,
      label: entry.label,
      url: `${origin}${probe.path}`,
      detailUrl: probe.detailPath ? `${origin}${probe.detailPath}` : undefined,
      token: probe.tokenEnv ? values[probe.tokenEnv] : undefined,
      readyField: probe.readyField,
      detailField: probe.detailField,
    });
  }
  return out;
}

/**
 * Remembered state is keyed by target rather than by id, so repointing an
 * integration at a different server starts from nothing instead of carrying
 * the old server's model name onto the new one.
 */
export function memoryKey(target: Pick<ProbeTarget, "id" | "url">): string {
  return `${target.id} ${target.url}`;
}

/** Read a dotted path out of a JSON body. */
export function readField(body: unknown, field?: string): unknown {
  if (!field) return undefined;
  let cur: unknown = body;
  for (const key of field.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Read a readiness flag.
 *
 * Absent means ready: a server too old to report the field still answered the
 * probe, and that is all the pill claims. Present means it has to actually say
 * yes — `null`, `0` and the string `"false"` are not yes.
 */
export function readReady(body: unknown, field?: string): boolean | undefined {
  if (!field) return undefined;
  const value = readField(body, field);
  if (value === undefined) return true;
  return value === true || value === 1 || value === "true";
}

/** Read a dotted path as display text, ignoring anything that is not scalar. */
export function readDetail(body: unknown, field?: string): string | undefined {
  const value = readField(body, field);
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

export interface ProbeReading {
  reachable: boolean;
  /** Undefined when the entry declares no `readyField`. */
  ready?: boolean;
  /**
   * Whether the detail endpoint answered. A server that answers and reports
   * no model is saying the model is gone, which is not the same as a detail
   * fetch that failed, and only the second one may keep the old value.
   */
  detailKnown?: boolean;
  detail?: string;
}

export interface ProbeMemory {
  state: PillState;
  detail?: string;
  /** When the server last answered. Drives the hold window. */
  okAt: number;
}

/**
 * Fold one reading into the remembered state for an integration.
 *
 * A reachable server replaces the memory outright. An unreachable one keeps
 * the last state only while that state is still recent, so the pill rides out
 * a server that is busy without ever presenting a stale observation as news.
 */
export function reduceProbe(
  prev: ProbeMemory | undefined,
  reading: ProbeReading,
  now: number,
  holdMs: number = STATE_HOLD_MS,
): ProbeMemory {
  if (reading.reachable) {
    return {
      state: reading.ready === false ? "notReady" : "online",
      detail: reading.detailKnown ? reading.detail : (reading.detail ?? prev?.detail),
      okAt: now,
    };
  }
  if (prev && now - prev.okAt < holdMs) return prev;
  return { state: "offline", detail: prev?.detail, okAt: prev?.okAt ?? 0 };
}

/**
 * A model ref shows as its last path segment with the weight extension gone.
 *
 * Only known weight extensions are stripped: a blanket "drop the last dotted
 * run" turns `mistral-7b-v0.3` into `mistral-7b-v0`, and most model families
 * carry a dotted version.
 */
export function shortenDetail(detail: string): string {
  const last = detail.split("/").filter(Boolean).pop() ?? detail;
  const bare = last.replace(/\.(gguf|bin|safetensors|pt|pth|onnx)$/i, "");
  return bare.length > DETAIL_MAX_CHARS ? `${bare.slice(0, DETAIL_MAX_CHARS - 1)}…` : bare;
}
