import test from "node:test";
import assert from "node:assert/strict";
import type { ConversationTokens } from "@/types/conversations";

/**
 * Occupancy is the latest turn, not the running sum.
 *
 * Every turn resends the whole conversation, so each turn's `input` already
 * contains the ones before it. Summing them counts the history once per turn
 * and the meter passes the context window while the model still has room: a
 * real two-turn task rendered "216.9k / 200k" and raised the compaction
 * banner. `total` stays a lifetime-spend figure; the meter reads `contextUsed`.
 */
function aggregate(turns: { input: number; output: number }[]): ConversationTokens {
  let input = 0;
  let output = 0;
  let contextUsed: number | undefined;
  for (const turn of turns) {
    input += turn.input;
    output += turn.output;
    contextUsed = turn.input + turn.output;
  }
  return { input, output, total: input + output, contextUsed };
}

test("occupancy tracks the latest turn while spend keeps accumulating", () => {
  // Turn 2 replays turn 1, which is why input grows rather than resets.
  const tokens = aggregate([
    { input: 20_000, output: 2_000 },
    { input: 30_000, output: 3_000 },
    { input: 45_000, output: 4_000 },
  ]);
  assert.equal(tokens.contextUsed, 49_000, "the model is holding the last turn");
  assert.equal(tokens.total, 104_000, "spend is still the sum of every turn");
  assert.ok(tokens.contextUsed! < tokens.total, "occupancy must not track spend");
});

test("a conversation well inside its window never reads full", () => {
  const tokens = aggregate([
    { input: 90_000, output: 8_000 },
    { input: 100_000, output: 9_000 },
  ]);
  const WINDOW = 200_000;
  const spendPct = (tokens.total / WINDOW) * 100;
  const realPct = (tokens.contextUsed! / WINDOW) * 100;
  assert.ok(spendPct > 100, "the old sum-based meter would have shown over 100%");
  assert.ok(realPct < 60, `occupancy is comfortably inside the window, got ${realPct}%`);
});

test("a single turn reports the same either way", () => {
  const tokens = aggregate([{ input: 10_000, output: 500 }]);
  assert.equal(tokens.contextUsed, tokens.total);
});
