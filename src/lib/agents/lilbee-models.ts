import { withAdapterRuntimeEnv } from "@/lib/agents/adapters/utils";
import { formatServedModel } from "@/lib/agents/runtime-format";
import type { ProviderModel } from "@/lib/agents/provider-interface";

/**
 * lilbee REST access derived from the runtime env. LILBEE_URL points at the
 * MCP endpoint (…/mcp); the REST API lives on the same origin.
 */
export function lilbeeRestConfig(
  env: NodeJS.ProcessEnv = withAdapterRuntimeEnv()
): { baseUrl: string; token?: string } | null {
  // LILBEE_URL only. ANTHROPIC_BASE_URL names any Anthropic-compatible
  // endpoint (LiteLLM, a Bedrock gateway, a corporate proxy); treating it as
  // lilbee would send the auth token to a host that never opted in, and let
  // its response replace the model catalog.
  const raw = env.LILBEE_URL;
  if (!raw) return null;
  let baseUrl: string;
  try {
    baseUrl = new URL(raw).origin;
  } catch {
    return null;
  }
  const token = env.LILBEE_TOKEN || env.ANTHROPIC_AUTH_TOKEN || undefined;
  return { baseUrl, token };
}

/**
 * lilbee model refs are repo paths ending in a GGUF filename. Keying on the
 * suffix rather than a slash keeps vendor-namespaced ids from other providers
 * (e.g. `opencode/minimax-m2.5-free`) out of the lilbee path, where they would
 * each cost a blocking HTTP round trip at task spawn.
 */
export function isLilbeeModelRef(model: string): boolean {
  return /\.gguf$/i.test(model);
}

async function lilbeeFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response | null> {
  const cfg = lilbeeRestConfig();
  if (!cfg) return null;
  const { timeoutMs = 5_000, ...rest } = init;
  try {
    return await fetch(`${cfg.baseUrl}${path}`, {
      ...rest,
      headers: {
        ...(rest.headers ?? {}),
        ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}

export interface LilbeeChatModels {
  active: string;
  installed: string[];
}

/** Installed chat models on the lilbee server, or null when unreachable. */
export async function listLilbeeChatModels(): Promise<LilbeeChatModels | null> {
  const res = await lilbeeFetch("/api/models");
  if (!res || !res.ok) return null;
  const body = (await res.json().catch(() => null)) as Record<
    string,
    { active?: string; installed?: string[] } | undefined
  > | null;
  if (!body?.chat) return null;
  // The per-role installed lists share one pool, so the chat list can carry
  // the embedding/vision/reranker models. Drop whatever is active in another
  // role — those are not chat models.
  const otherActives = new Set(
    ["embedding", "vision", "reranker"]
      .map((role) => body[role]?.active)
      .filter((ref): ref is string => Boolean(ref))
  );
  const installed = (body.chat.installed ?? []).filter((ref) => !otherActives.has(ref));
  return { active: body.chat.active ?? "", installed };
}

/** Picker entries for the installed chat models, active model first. */
export function toProviderModels(models: LilbeeChatModels): ProviderModel[] {
  const ordered = [
    ...models.installed.filter((ref) => ref === models.active),
    ...models.installed.filter((ref) => ref !== models.active),
  ];
  return ordered.map((ref) => ({
    id: ref,
    name: formatServedModel(ref),
    description:
      ref === models.active
        ? "Active on the lilbee server"
        : "Installed on the lilbee server — selecting it swaps the engine",
  }));
}

/**
 * Make `ref` the active chat model before a task runs against it. The swap
 * endpoint reloads the engine; requests sent during the reload queue until
 * the model is up, so callers can spawn immediately after this resolves.
 */
export async function ensureLilbeeChatModel(ref: string): Promise<void> {
  if (!isLilbeeModelRef(ref)) return;
  const current = await listLilbeeChatModels();
  if (!current || current.active === ref) return;
  if (!current.installed.includes(ref)) return;
  const res = await lilbeeFetch("/api/models/chat", {
    method: "PUT",
    body: JSON.stringify({ model: ref }),
    timeoutMs: 120_000,
  });
  if (!res || !res.ok) {
    throw new Error(
      `lilbee did not switch to ${ref}${res ? ` (HTTP ${res.status})` : " (server unreachable)"}. ` +
        "The task would have run on a different model, so it was not started."
    );
  }
}
