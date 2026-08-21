import test from "node:test";
import assert from "node:assert/strict";
import { MCP_CATALOG } from "@/lib/agents/mcp-catalog";

// Meta never listed the ads connector in the Official MCP Registry. A
// `registryId` on this entry would substring-match a third party's listing
// (`ai.adweave/meta-ads-mcp`) via `name.includes(needle)` in
// mcp-registry-verify.ts and mint a false "Official" badge. This must never
// come back.
test("META_ADS never gains a registryId", () => {
  const entry = MCP_CATALOG.find((e) => e.id === "meta-ads");
  assert.ok(entry, "expected a meta-ads entry in MCP_CATALOG");
  assert.equal(entry.registryId, undefined, "meta-ads must never carry a registryId");
});

// The only way to stop a local thinking model from reasoning is the env var
// Claude Code translates into `thinking: {"type":"disabled"}`. Cabinet ships no
// toggle for it, so the catalog copy IS the mechanism. If the name drifts or the
// step disappears, the operator has no way to find it.
test("the lilbee entry documents the reasoning toggle", () => {
  const entry = MCP_CATALOG.find((e) => e.id === "lilbee");
  assert.ok(entry, "expected a lilbee entry in MCP_CATALOG");
  const step = entry.setupSteps.find((s) => /messages_reasoning/.test(s.copy ?? ""));
  assert.ok(step, "lilbee must keep a setup step for turning reasoning off");
  assert.match(step.body, /messages_reasoning/);
  assert.match(step.body, /MAX_THINKING_TOKENS=0/);
  assert.match(step.body, /\.cabinet\.env/);
});

// `vendor` tier is only honest when the UI can say *whose* vendor. Every
// vendor-tier entry must carry a vendorName so the badge reads
// "Published by <vendor>" rather than a bare, unattributed claim.
test("every vendor-tier catalog entry carries a vendorName", () => {
  const vendorEntries = MCP_CATALOG.filter((e) => e.trustTier === "vendor");
  assert.ok(vendorEntries.length > 0, "expected at least one vendor-tier entry to guard");
  for (const entry of vendorEntries) {
    assert.ok(
      entry.vendorName && entry.vendorName.trim().length > 0,
      `vendor-tier entry "${entry.id}" is missing vendorName`,
    );
  }
});

// A status pill reads its server URL out of `.cabinet.env`, and the only keys
// that land there are the ones the entry itself asks for. A probe naming a key
// the entry never declares would render no pill and give no clue why, so tie
// the two together here rather than at runtime.
test("every status probe names env keys its own entry declares", () => {
  // No assertion that any entry declares one: the trait is generic, and a
  // catalog that ships none is a legitimate catalog.
  for (const entry of MCP_CATALOG.filter((e) => e.statusProbe)) {
    const probe = entry.statusProbe!;
    const declared = new Set(
      Object.values(entry.serverEnv ?? {})
        .map((v) => /^\$\{([A-Z0-9_]+)\}$/.exec(v)?.[1])
        .filter((k): k is string => Boolean(k)),
    );
    assert.ok(
      declared.has(probe.urlEnv),
      `${entry.id}: statusProbe.urlEnv "${probe.urlEnv}" is not in serverEnv`,
    );
    if (probe.tokenEnv) {
      assert.ok(
        declared.has(probe.tokenEnv),
        `${entry.id}: statusProbe.tokenEnv "${probe.tokenEnv}" is not in serverEnv`,
      );
    }
    assert.match(probe.path, /^\//, `${entry.id}: statusProbe.path must start with "/"`);
    if (probe.detailPath) {
      assert.match(probe.detailPath, /^\//, `${entry.id}: statusProbe.detailPath must start with "/"`);
    }
    assert.equal(
      Boolean(probe.detailPath),
      Boolean(probe.detailField),
      `${entry.id}: detailPath and detailField only work as a pair`,
    );
  }
});

// Ids key the config writer's server map, React lists, and the status route's
// per-server memory. A duplicate would silently make one entry shadow another.
test("every catalog entry has a unique id", () => {
  const seen = new Set<string>();
  for (const entry of MCP_CATALOG) {
    assert.ok(!seen.has(entry.id), `duplicate catalog id "${entry.id}"`);
    seen.add(entry.id);
  }
});
