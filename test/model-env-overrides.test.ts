import test from "node:test";
import assert from "node:assert/strict";
import { applyModelEnvOverrides } from "@/lib/agents/model-env-overrides";

const MODELS = [
  { id: "sonnet", name: "Claude Sonnet 5", description: "Fast and capable" },
  { id: "sonnet[1m]", name: "Claude Sonnet 5 (1M context)", description: "Long sessions" },
  { id: "haiku", name: "Claude Haiku 4.5", description: "Fastest responses" },
  { id: "opusplan", name: "Opus + Sonnet (opusplan)", description: "Plan/execute split" },
];

test("remapped aliases show the served model name", () => {
  const out = applyModelEnvOverrides("claude-code", MODELS, {
    ANTHROPIC_DEFAULT_SONNET_MODEL: "unsloth/Qwen3.6-27B-GGUF/Qwen3.6-27B-Q5_K_M.gguf",
  });
  assert.equal(out[0].name, "Qwen3.6-27B-Q5_K_M");
  assert.match(out[0].description ?? "", /runs Qwen3\.6-27B-Q5_K_M/);
  assert.equal(out[1].name, "Qwen3.6-27B-Q5_K_M");
  assert.equal(out[2].name, "Claude Haiku 4.5");
  assert.equal(out[3].name, "Opus + Sonnet (opusplan)");
});

test("no env remap leaves the catalog untouched", () => {
  const out = applyModelEnvOverrides("claude-code", MODELS, {});
  assert.deepEqual(out, MODELS);
});

test("other providers are never relabeled", () => {
  const out = applyModelEnvOverrides("cursor-cli", MODELS, {
    ANTHROPIC_DEFAULT_SONNET_MODEL: "unsloth/Qwen3.6-27B-GGUF/Qwen3.6-27B-Q5_K_M.gguf",
  });
  assert.deepEqual(out, MODELS);
});
