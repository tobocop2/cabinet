import test from "node:test";
import assert from "node:assert/strict";
import {
  isLilbeeModelRef,
  lilbeeRestConfig,
  toProviderModels,
} from "@/lib/agents/lilbee-models";

test("repo-path refs are lilbee models; aliases are not", () => {
  assert.equal(isLilbeeModelRef("unsloth/Qwen3.6-27B-GGUF/Qwen3.6-27B-Q5_K_M.gguf"), true);
  assert.equal(isLilbeeModelRef("sonnet"), false);
  assert.equal(isLilbeeModelRef("opus[1m]"), false);
});

test("rest config strips the /mcp path and carries the token", () => {
  const cfg = lilbeeRestConfig({
    NODE_ENV: "test" as const,
    LILBEE_URL: "http://127.0.0.1:8383/mcp",
    LILBEE_TOKEN: "tok",
  });
  assert.deepEqual(cfg, { baseUrl: "http://127.0.0.1:8383", token: "tok" });
});

test("rest config falls back to ANTHROPIC_BASE_URL and is null without either", () => {
  const cfg = lilbeeRestConfig({
    NODE_ENV: "test" as const,
    ANTHROPIC_BASE_URL: "http://127.0.0.1:8383",
    ANTHROPIC_AUTH_TOKEN: "tok2",
  });
  assert.deepEqual(cfg, { baseUrl: "http://127.0.0.1:8383", token: "tok2" });
  assert.equal(lilbeeRestConfig({ NODE_ENV: "test" as const }), null);
});

test("picker entries put the active model first with honest descriptions", () => {
  const out = toProviderModels({
    active: "b/repo/B-Q4.gguf",
    installed: ["a/repo/A-Q5.gguf", "b/repo/B-Q4.gguf"],
  });
  assert.equal(out[0].id, "b/repo/B-Q4.gguf");
  assert.equal(out[0].name, "B-Q4");
  assert.match(out[0].description ?? "", /Active on the lilbee server/);
  assert.equal(out[1].name, "A-Q5");
  assert.match(out[1].description ?? "", /swaps the engine/);
});
