import test from "node:test";
import assert from "node:assert/strict";
import { mergeAdapterEnv } from "@/lib/agents/adapters/utils";

test("live file values win over boot-time snapshots of file-owned keys", () => {
  const out = mergeAdapterEnv(
    { ANTHROPIC_DEFAULT_SONNET_MODEL: "repo/new.gguf" },
    { NODE_ENV: "test" as const, ANTHROPIC_DEFAULT_SONNET_MODEL: "repo/old-boot-copy.gguf", HOME: "/home/u" },
    new Set(["ANTHROPIC_DEFAULT_SONNET_MODEL"]),
  );
  assert.equal(out.ANTHROPIC_DEFAULT_SONNET_MODEL, "repo/new.gguf");
  assert.equal(out.HOME, "/home/u");
});

test("genuine shell overrides still win over file values", () => {
  const out = mergeAdapterEnv(
    { LILBEE_URL: "http://file:1" },
    { NODE_ENV: "test" as const, LILBEE_URL: "http://shell:2" },
    new Set(),
  );
  assert.equal(out.LILBEE_URL, "http://shell:2");
});

test("a key removed from the file drops its boot-time snapshot", () => {
  const out = mergeAdapterEnv(
    {},
    { NODE_ENV: "test" as const, ANTHROPIC_AUTH_TOKEN: "stale-boot-copy" },
    new Set(["ANTHROPIC_AUTH_TOKEN"]),
  );
  assert.equal("ANTHROPIC_AUTH_TOKEN" in out, false);
});
