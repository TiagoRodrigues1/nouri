import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { budgetedBody, usageWindows } from "../../src/request-limits.js";
import { requestPolicy as requestLimits } from "../../src/request-policy.js";
import { boundedExport } from "../../src/account/export-limits.js";

void test("MCP rate limits apply before auth and cannot be bypassed by spoofing forwarded IPs", async () => {
  const app = new Hono();
  const limits = requestLimits();
  let authCalls = 0;
  app.use(limits.beforeRequest);
  app.use("/v1/progress-photos", limits.beforeUpload);
  app.post("/mcp", (context) => { authCalls++;

 return context.body(null, 401); });

  for (let index = 0; index < 60; index++) assert.equal((await app.request("/mcp", { method: "POST", headers: { "X-Forwarded-For": `192.0.2.${index}` } })).status, 401);
  const refused = await app.request("/mcp", { method: "POST" });
  assert.equal(refused.status, 429);
  assert.equal(refused.headers.get("Retry-After"), "60");
  assert.equal(authCalls, 60);
});

void test("body sizes are rejected before reaching JSON or webhook handlers", async () => {
  const app = new Hono();
  const limits = requestLimits();
  let calls = 0;
  app.use(limits.beforeRequest);
  app.use("/v1/progress-photos", limits.beforeUpload);
  app.post("*", (context) => { calls++;

 return context.text("ok"); });

  for (const path of ["/v1/water-entries", "/webhooks/clerk", "/mcp"]) {
    assert.equal((await app.request(path, { method: "POST", body: "x".repeat(256 * 1024 + 1) })).status, 413);
  }

  assert.equal((await app.request("/v1/progress-photos", { method: "POST", body: "x".repeat(9 * 1024 * 1024) })).status, 413);
  assert.equal(calls, 0);
});

void test("PUT writes, repeated uploads, and photo bandwidth have account allowances", () => {
  const writes = requestLimits();

  for (let index = 0; index < 120; index++) assert.equal(writes.forUser("writer", "PUT", "/v1/dashboard"), null);
  assert.equal(writes.forUser("writer", "PUT", "/v1/dashboard")?.status, 429);
  const photos = requestLimits();

  for (let index = 0; index < 20; index++) assert.equal(photos.forUser("uploader", "POST", "/v1/progress-photos"), null);
  assert.equal(photos.forUser("uploader", "POST", "/v1/progress-photos")?.status, 429);

  for (let index = 0; index < 60; index++) assert.equal(photos.forUser("viewer", "GET", "/v1/progress-photos/id/image"), null);
  assert.equal(photos.forUser("viewer", "GET", "/v1/progress-photos/id/image")?.status, 429);
  assert.equal(photos.forUser("another-viewer", "GET", "/v1/progress-photos/id/image"), null);

  for (let index = 0; index < 64; index++) assert.equal(photos.photoDownload("viewer", 8 * 1024 * 1024), null);
  assert.equal(photos.photoDownload("viewer", 1)?.status, 429);
  assert.equal(photos.photoDownload("another-viewer", 256 * 1024), null);
});

void test("request concurrency is bounded before slow authentication and capacity returns afterward", async () => {
  const app = new Hono();
  const limits = requestLimits();
  let finish: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => { finish = resolve; });
  app.use(limits.beforeRequest);
  app.use("/v1/progress-photos", limits.beforeUpload);
  app.get("/v1/test", async (context) => { await wait;

 return context.body(null, 401); });
  const pending = Array.from({ length: 32 }, () => Promise.resolve(app.request("/v1/test")));
  assert.equal((await app.request("/v1/test")).status, 429);
  finish();
  assert.ok((await Promise.all(pending)).every((response) => response.status === 401));
  assert.equal((await app.request("/v1/test")).status, 401);
});

void test("only two large photo uploads can occupy handlers at once", async () => {
  const app = new Hono();
  const limits = requestLimits();
  let finish: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => { finish = resolve; });
  app.use(limits.beforeRequest);
  app.use("/v1/progress-photos", limits.beforeUpload);
  app.post("/v1/progress-photos", async (context) => { await wait;

 return context.body(null, 401); });
  const pending = Array.from({ length: 2 }, () => Promise.resolve(app.request("/v1/progress-photos", { method: "POST" })));
  assert.equal((await app.request("/v1/progress-photos", { method: "POST" })).status, 429);
  finish();
  assert.ok((await Promise.all(pending)).every((response) => response.status === 401));
  assert.equal((await app.request("/v1/progress-photos", { method: "POST" })).status, 401);
});

void test("usage windows expire without allowing caller-controlled keys to clear existing allowances", () => {
  let time = 0;
  const consume = usageWindows(() => time);
  assert.equal(consume("first", 1, 100), true);

  for (let index = 0; index < 9999; index++) assert.equal(consume(`account:${index}`, 1, 100), true);
  assert.equal(consume("overflow", 1, 100), false);
  assert.equal(consume("first", 1, 100), false);
  time = 101;
  assert.equal(consume("overflow", 1, 100), true);
  assert.equal(consume("first", 1, 100), true);
});

void test("export slots stay occupied until streamed responses end or are cancelled", async () => {
  const limits = requestLimits();
  let cancelled = false;
  const source = () => new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const stream = limits.exportStream("first", source);
  const other = limits.exportStream("second", source);
  assert.ok(!(stream instanceof Response));
  assert.ok(!(other instanceof Response));
  const firstRefused = limits.exportStream("first", source);
  const thirdRefused = limits.exportStream("third", source);
  assert.ok(firstRefused instanceof Response);
  assert.ok(thirdRefused instanceof Response);
  assert.equal(firstRefused.status, 429);
  assert.equal(thirdRefused.status, 429);
  await stream.cancel();
  assert.equal(cancelled, true);
  const third = limits.exportStream("third", source);
  assert.ok(!(third instanceof Response));
  await third.cancel();
  await other.cancel();
  let finished = 0;
  const completed = boundedExport(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } }), () => { finished++; });
  assert.deepEqual(new Uint8Array(await new Response(completed).arrayBuffer()), new Uint8Array([1]));
  assert.equal(finished, 1);
});

void test("a stalled export is cancelled and releases its slot at its deadline", async () => {
  let released = false;
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const result = boundedExport(source, () => { released = true; }, 10);
  const keepAlive = setTimeout(() => undefined, 1000);

  try {
    await assert.rejects(new Response(result).arrayBuffer(), /timed out/);
    assert.equal(cancelled, true);
    assert.equal(released, true);
  } finally {
    clearTimeout(keepAlive);
  }
});

void test("response byte allowances stop a download and cancel its underlying source", async () => {
  let cancelled = false;
  const consume = usageWindows();

  const source = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(6)); },
    cancel() { cancelled = true; },
  });

  const body = budgetedBody(source, (bytes) => consume("traffic", 10, 60_000, bytes));
  await assert.rejects(new Response(body).arrayBuffer(), /Download allowance reached/);
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  assert.equal(cancelled, true);
});

void test("background-import checks have their own cap and leave the write budget alone", () => {
  const limits = requestLimits();
  const refresh = "/v1/integrations/google-health/refreshes";

  for (let index = 0; index < 30; index++) assert.equal(limits.forUser("reader", "POST", refresh), null);
  assert.equal(limits.forUser("reader", "POST", refresh)?.status, 429);

  // All 120 hourly writes remain after the checks.
  for (let index = 0; index < 120; index++) assert.equal(limits.forUser("reader", "PUT", "/v1/dashboard"), null);
  assert.equal(limits.forUser("reader", "PUT", "/v1/dashboard")?.status, 429);
});

void test("rejected account writes cannot exhaust another account's shared write allowance", () => {
  let time = 0;
  const limits = requestLimits(() => time);
  let accepted = 0;

  for (let index = 0; index < 5000; index++) {
    if (index && index % 180 === 0) time += 60_001;

    if (!limits.forUser("blocked-account", "PUT", "/v1/targets")) accepted++;
  }

  assert.equal(accepted, 120);
  assert.equal(limits.forUser("fresh-account", "PUT", "/v1/targets"), null);
});

void test("failed multi-budget reservations leave every allowance unchanged", () => {
  const consume = usageWindows();
  assert.equal(consume("full", 1, 60_000), true);
  assert.equal(consume.reserve([
    { key: "available", maximum: 1, duration: 60_000 },
    { key: "full", maximum: 1, duration: 60_000 },
  ]), false);
  assert.equal(consume("available", 1, 60_000), true);

  // Duplicate keys also accumulate before committing, rather than overwriting each other's usage.
  assert.equal(consume.reserve([
    { key: "duplicate", maximum: 1, duration: 60_000 },
    { key: "duplicate", maximum: 1, duration: 60_000 },
  ]), false);
  assert.equal(consume("duplicate", 1, 60_000), true);
});

void test("rejected photo uploads leave the account write allowance available", () => {
  let time = 0;
  const limits = requestLimits(() => time);

  for (let index = 0; index < 20; index++) assert.equal(limits.forUser("uploader", "POST", "/v1/progress-photos"), null);

  for (let index = 0; index < 100; index++) assert.equal(limits.forUser("uploader", "POST", "/v1/progress-photos")?.status, 429);
  time += 60_001;

  for (let index = 0; index < 100; index++) assert.equal(limits.forUser("uploader", "PUT", "/v1/targets"), null);
  assert.equal(limits.forUser("uploader", "PUT", "/v1/targets")?.status, 429);
});
