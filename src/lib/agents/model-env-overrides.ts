import { formatServedModel } from "@/lib/agents/runtime-format";

/**
 * Claude Code model aliases that ANTHROPIC_DEFAULT_*_MODEL variables remap.
 * When a runtime env remaps an alias (e.g. to a local model behind
 * ANTHROPIC_BASE_URL), the picker must show the model that actually runs —
 * an alias label like "Claude Sonnet 5" would be wrong.
 */
const CLAUDE_ALIAS_ENV_KEYS: Record<string, string> = {
  fable: "ANTHROPIC_DEFAULT_FABLE_MODEL",
  opus: "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "opus[1m]": "ANTHROPIC_DEFAULT_OPUS_MODEL",
  sonnet: "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "sonnet[1m]": "ANTHROPIC_DEFAULT_SONNET_MODEL",
  haiku: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
};

/**
 * Relabel catalog entries whose alias is remapped by the runtime env.
 * `env` is the effective adapter environment (cabinet env file merged
 * under process.env, matching how adapters are spawned).
 */
export function applyModelEnvOverrides<T extends { id: string; name: string; description?: string }>(
  providerId: string,
  models: T[],
  env: Record<string, string | undefined>,
): T[] {
  if (providerId !== "claude-code") return models;
  return models.map((model) => {
    const key = CLAUDE_ALIAS_ENV_KEYS[model.id];
    const mapped = key ? env[key] : undefined;
    if (!mapped) return model;
    const served = formatServedModel(mapped);
    return {
      ...model,
      name: served,
      description: `The "${model.id}" alias runs ${served} (set in .cabinet.env)`,
    };
  });
}
