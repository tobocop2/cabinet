import test from "node:test";
import assert from "node:assert/strict";
import { resolveServerEnv } from "@/lib/agents/mcp-config-writer";

const values = { LILBEE_URL: "http://127.0.0.1:8383/mcp", EMPTY_ONE: "" };

test("a ${VAR} placeholder is replaced by its value, not written literally", () => {
  // The spawned server receives this env verbatim: a literal "${LILBEE_URL}"
  // is not a URL, so a remote-mode server silently runs against its local
  // default instead of the configured host.
  const out = resolveServerEnv({ LILBEE_URL: "${LILBEE_URL}" }, values);
  assert.equal(out?.LILBEE_URL, "http://127.0.0.1:8383/mcp");
});

test("an unset or empty placeholder is dropped so the server keeps its default", () => {
  assert.equal(resolveServerEnv({ NOPE: "${NOT_SET}" }, values), undefined);
  assert.equal(resolveServerEnv({ NOPE: "${EMPTY_ONE}" }, values), undefined);
});

test("a literal value passes through untouched", () => {
  assert.equal(resolveServerEnv({ MODE: "http-only" }, values)?.MODE, "http-only");
});
