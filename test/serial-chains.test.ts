import test from "node:test";
import assert from "node:assert/strict";
import { SerialChains } from "../server/serial-chains";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("tasks for one key run in enqueue order even when later tasks are faster", async () => {
  const chains = new SerialChains();
  const order: number[] = [];
  // Task 0 is slow, tasks 1..4 are instant: unchained they'd finish first.
  void chains.run("s", async () => {
    await sleep(30);
    order.push(0);
  });
  for (let i = 1; i < 5; i++) {
    void chains.run("s", async () => {
      order.push(i);
    });
  }
  await chains.drain("s");
  assert.deepEqual(order, [0, 1, 2, 3, 4]);
});

test("keys do not block each other", async () => {
  const chains = new SerialChains();
  const order: string[] = [];
  void chains.run("slow", async () => {
    await sleep(40);
    order.push("slow");
  });
  await chains.run("fast", async () => {
    order.push("fast");
  });
  assert.deepEqual(order, ["fast"]);
  await chains.drain("slow");
});

test("a failing task reports the error and does not break the chain", async () => {
  const chains = new SerialChains();
  const errors: unknown[] = [];
  const order: string[] = [];
  void chains.run("s", async () => {
    throw new Error("boom");
  }, (e) => errors.push(e));
  await chains.run("s", async () => {
    order.push("after");
  });
  assert.equal(errors.length, 1);
  assert.deepEqual(order, ["after"]);
});

test("drain resolves for keys with nothing pending", async () => {
  await new SerialChains().drain("never-used");
});
