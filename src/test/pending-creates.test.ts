import assert from "node:assert/strict";
import { test } from "node:test";
import { PendingCreates } from "../../frontend/src/lib/pending-creates.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });

  return { promise, resolve, reject };
}

void test("a successful create does not discard another operation's retry key", async () => {
  const pending = new PendingCreates<string, string>();
  const a = deferred<string>();
  const b = deferred<string>();
  const sent: { input: string; key: string }[] = [];

  const send = (input: string, key: string) => {
    sent.push({ input, key });

    return input === "A" ? a.promise : b.promise;
  };

  const first = pending.run("A", "A", send);
  const second = pending.run("B", "B", send);
  const failed = assert.rejects(second, /response lost/);

  a.resolve("saved A");
  const savedA = await first;
  pending.complete("A", savedA.key);
  b.reject(new Error("response lost"));
  await failed;

  const retried = pending.run("B", "B", async (input, key) => {
    sent.push({ input, key });

    return "saved B";
  });

  const savedB = await retried;

  assert.equal(sent[1]?.key, sent[2]?.key);
  assert.notEqual(sent[0]?.key, sent[1]?.key);
  pending.complete("B", savedB.key);

  await pending.run("B", "B", async (input, key) => {
    sent.push({ input, key });

    return "new B";
  });
  assert.notEqual(sent[2]?.key, sent[3]?.key);
});

void test("overlapping attempts for the same operation share one request", async () => {
  const pending = new PendingCreates<string, string>();
  const reply = deferred<string>();
  const sent: string[] = [];

  const send = async (_input: string, key: string) => {
    sent.push(key);

    return reply.promise;
  };

  const first = pending.run("A", "A", send);
  const second = pending.run("A", "A", send);

  assert.equal(sent.length, 1);
  reply.resolve("saved");
  assert.deepEqual(await first, await second);
});
