import test from "node:test";
import assert from "node:assert/strict";
import {
  STATE_HOLD_MS,
  memoryKey,
  probeTargets,
  readDetail,
  readField,
  readReady,
  reduceProbe,
  shortenDetail,
  type ProbeableEntry,
} from "@/lib/integrations/status-probe";

const probed: ProbeableEntry = {
  id: "probed",
  label: "Probed",
  statusProbe: {
    urlEnv: "EX_URL",
    tokenEnv: "EX_TOKEN",
    path: "/api/health",
    readyField: "ready",
    detailPath: "/api/models",
    detailField: "chat.active",
  },
};

test("only connected entries that declare a probe are polled", () => {
  const plain: ProbeableEntry = { id: "plain", label: "Plain" };
  const targets = probeTargets([plain, probed], () => true, {
    EX_URL: "http://127.0.0.1:8383",
    EX_TOKEN: "secret",
  });
  assert.deepEqual(targets, [
    {
      id: "probed",
      label: "Probed",
      url: "http://127.0.0.1:8383/api/health",
      detailUrl: "http://127.0.0.1:8383/api/models",
      token: "secret",
      readyField: "ready",
      detailField: "chat.active",
    },
  ]);
});

test("a disconnected integration is not polled", () => {
  assert.deepEqual(probeTargets([probed], () => false, { EX_URL: "http://x:1" }), []);
});

test("an unconfigured or malformed URL is skipped rather than reported down", () => {
  assert.deepEqual(probeTargets([probed], () => true, {}), []);
  assert.deepEqual(probeTargets([probed], () => true, { EX_URL: "not a url" }), []);
});

test("the probe URL keeps only the origin, so a path in the env var cannot leak in", () => {
  const [target] = probeTargets([probed], () => true, {
    EX_URL: "http://127.0.0.1:8383/mcp?token=abc",
  });
  assert.equal(target.url, "http://127.0.0.1:8383/api/health");
  assert.equal(target.detailUrl, "http://127.0.0.1:8383/api/models");
});

test("memory is keyed by server, so repointing an integration does not inherit state", () => {
  const a = memoryKey({ id: "probed", url: "http://127.0.0.1:8383/api/health" });
  const b = memoryKey({ id: "probed", url: "http://gpu-box:8383/api/health" });
  assert.notEqual(a, b);
});

test("fields read through a dotted path and tolerate a missing one", () => {
  assert.equal(readDetail({ a: { b: "model.gguf" } }, "a.b"), "model.gguf");
  assert.equal(readDetail({ a: { b: 7 } }, "a.b"), "7");
  assert.equal(readDetail({ a: {} }, "a.b"), undefined);
  assert.equal(readDetail(null, "a.b"), undefined);
  assert.equal(readDetail({ a: { b: "  " } }, "a.b"), undefined);
  assert.equal(readDetail({ a: { b: "x" } }, undefined), undefined);
  assert.equal(readField({ chat_ready: false }, "chat_ready"), false);
});

test("readiness needs an actual yes, but an absent field still counts as ready", () => {
  // A server too old to report the field answered the probe; that is the claim.
  assert.equal(readReady({}, "chat_ready"), true);
  assert.equal(readReady({ chat_ready: true }, "chat_ready"), true);
  assert.equal(readReady({ chat_ready: 1 }, "chat_ready"), true);
  assert.equal(readReady({ chat_ready: "true" }, "chat_ready"), true);
  // Present and not a yes must not read as ready.
  assert.equal(readReady({ chat_ready: false }, "chat_ready"), false);
  assert.equal(readReady({ chat_ready: null }, "chat_ready"), false);
  assert.equal(readReady({ chat_ready: 0 }, "chat_ready"), false);
  assert.equal(readReady({ chat_ready: "false" }, "chat_ready"), false);
  // No readyField declared: nothing to say.
  assert.equal(readReady({ chat_ready: false }, undefined), undefined);
});

test("a server that is up but not ready reads as notReady, not online", () => {
  assert.equal(reduceProbe(undefined, { reachable: true, ready: true }, 1000).state, "online");
  assert.equal(reduceProbe(undefined, { reachable: true, ready: false }, 1000).state, "notReady");
  assert.equal(reduceProbe(undefined, { reachable: true }, 1000).state, "online");
});

test("a busy server holds its last state, but only while that state is recent", () => {
  const online = reduceProbe(undefined, { reachable: true, ready: true, detailKnown: true, detail: "m" }, 0);
  const busy = reduceProbe(online, { reachable: false }, 10_000);
  assert.equal(busy.state, "online", "a stalled probe is as likely to mean busy as down");
  const later = reduceProbe(busy, { reachable: false }, STATE_HOLD_MS + 1);
  assert.equal(later.state, "offline");
});

test("a probe after a long gap never presents a stale observation as news", () => {
  // The tab was hidden for an hour; the first probe on return fails. Holding
  // the old green would report an hour-old reading as current.
  const online = reduceProbe(undefined, { reachable: true, ready: true, detailKnown: true, detail: "m" }, 0);
  const afterGap = reduceProbe(online, { reachable: false }, 3_600_000);
  assert.equal(afterGap.state, "offline");
});

test("a server that reports no model clears the pill instead of naming a stale one", () => {
  const online = reduceProbe(undefined, { reachable: true, ready: true, detailKnown: true, detail: "Qwen" }, 0);
  // The detail endpoint answered and said there is nothing loaded.
  const unloaded = reduceProbe(online, { reachable: true, ready: true, detailKnown: true }, 1_000);
  assert.equal(unloaded.detail, undefined);
  // A detail fetch that simply failed keeps the last known value.
  const fetchFailed = reduceProbe(online, { reachable: true, ready: true, detailKnown: false }, 1_000);
  assert.equal(fetchFailed.detail, "Qwen");
});

test("a first probe against a server that is not running reports offline at once", () => {
  assert.equal(reduceProbe(undefined, { reachable: false }, 1000).state, "offline");
});

test("recovery resets the hold window", () => {
  const down = reduceProbe(undefined, { reachable: false }, 0);
  const up = reduceProbe(down, { reachable: true, ready: true }, 1_000);
  assert.equal(up.state, "online");
  assert.equal(up.okAt, 1_000);
});

test("a model ref shortens without eating its version", () => {
  assert.equal(shortenDetail("unsloth/Qwen3.6-35B-GGUF/Qwen3.6-35B-Q5_K_M.gguf"), "Qwen3.6-35B-Q5_K_M");
  // A blanket "drop the last dotted run" would render these as
  // "mistral-7b-v0" and "llama3".
  assert.equal(shortenDetail("mistral-7b-v0.3"), "mistral-7b-v0.3");
  assert.equal(shortenDetail("llama3.2"), "llama3.2");
  assert.equal(shortenDetail("model.safetensors"), "model");
  assert.equal(shortenDetail("plain"), "plain");
});

test("an absurdly long model id cannot stretch the status bar", () => {
  const short = shortenDetail("x".repeat(200));
  assert.ok(short.length <= 40, `expected a capped label, got ${short.length} chars`);
  assert.ok(short.endsWith("…"));
});
