import test from "node:test";
import assert from "node:assert/strict";
import {
  isLilbeeModelRef,
  lilbeeRestConfig,
  toProviderModels,
} from "@/lib/agents/lilbee-models";

test("only GGUF refs are lilbee models", () => {
  assert.equal(isLilbeeModelRef("unsloth/Qwen3.6-27B-GGUF/Qwen3.6-27B-Q5_K_M.gguf"), true);
  assert.equal(isLilbeeModelRef("sonnet"), false);
  assert.equal(isLilbeeModelRef("opus[1m]"), false);
  // A vendor-namespaced id from another provider must not take the lilbee
  // path: it would cost a blocking HTTP round trip on every task spawn.
  assert.equal(isLilbeeModelRef("opencode/minimax-m2.5-free"), false);
});

test("rest config strips the /mcp path and carries the token", () => {
  const cfg = lilbeeRestConfig({
    NODE_ENV: "test" as const,
    LILBEE_URL: "http://127.0.0.1:8383/mcp",
    LILBEE_TOKEN: "tok",
  });
  assert.deepEqual(cfg, { baseUrl: "http://127.0.0.1:8383", token: "tok" });
});

test("ANTHROPIC_BASE_URL alone is not lilbee", () => {
  // That variable names any Anthropic-compatible endpoint; treating it as
  // lilbee would send the auth token to a host that never opted in.
  assert.equal(
    lilbeeRestConfig({
      NODE_ENV: "test" as const,
      ANTHROPIC_BASE_URL: "https://llm.corp",
      ANTHROPIC_AUTH_TOKEN: "tok2",
    }),
    null
  );
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
