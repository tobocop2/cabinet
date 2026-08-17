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
  const step = entry.setupSteps.find((s) => s.copy === "MAX_THINKING_TOKENS=0");
  assert.ok(step, "lilbee must keep a setup step that copies MAX_THINKING_TOKENS=0");
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
