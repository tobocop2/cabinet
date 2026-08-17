import test from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeLabel, formatServedModel } from "@/lib/agents/runtime-format";

test("formatServedModel shortens a GGUF path ref to its basename", () => {
  assert.equal(
    formatServedModel(
      "unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF/Qwen3-Coder-30B-A3B-Instruct-Q6_K.gguf"
    ),
    "Qwen3-Coder-30B-A3B-Instruct-Q6_K"
  );
  assert.equal(formatServedModel("claude-sonnet-4-5-20250929"), "claude-sonnet-4-5-20250929");
});

test("buildRuntimeLabel prefers the wire-reported model over the requested alias", () => {
  const label = buildRuntimeLabel({
    providerId: "claude-code",
    adapterConfig: { model: "sonnet", effort: "medium" },
    runtime: { servedModel: "unsloth/Repo-GGUF/Model-Q6_K.gguf" },
  });
  assert.ok(label?.startsWith("Model-Q6_K · "), label ?? "null");
});

test("buildRuntimeLabel falls back to the requested alias without a served model", () => {
  const label = buildRuntimeLabel({
    providerId: "claude-code",
    adapterConfig: { model: "sonnet", effort: "medium" },
  });
  assert.ok(label?.startsWith("sonnet · "), label ?? "null");
});
