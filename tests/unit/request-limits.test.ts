import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { budgetedBody, usageWindows } from "../../src/request-limits.js";
import { requestPolicy as requestLimits } from "../../src/request-policy.js";
import { boundedExport } from "../../src/account/export-limits.js";
import { accountAccess } from "../../src/identity/access.js";
import type { Identity } from "../../src/identity/identity.js";
import { rememberedLookups, type PackagedLookup } from "../../src/food/packaged.js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { CallerVariables } from "../../src/request-limits.js";

const anonymous = { identify: async () => null };

// Signs in "person" only with the valid token; any other bearer is forged.
const signedIn = { identify: async (request: Request) => request.headers.get("Authorization") === "Bearer valid" ? "person" : null };

void test("MCP rate limits apply before auth and cannot be bypassed by spoofing forwarded IPs", async () => {
  const app = new Hono();
  const limits = requestLimits(anonymous);
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
  const limits = requestLimits(anonymous);
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
  const writes = requestLimits(anonymous);

  for (let index = 0; index < 120; index++) assert.equal(writes.forUser("writer", "PUT", "/v1/dashboard"), null);
  assert.equal(writes.forUser("writer", "PUT", "/v1/dashboard")?.status, 429);
  const photos = requestLimits(anonymous);

  for (let index = 0; index < 20; index++) assert.equal(photos.forUser("uploader", "POST", "/v1/progress-photos"), null);
  assert.equal(photos.forUser("uploader", "POST", "/v1/progress-photos")?.status, 429);

  for (let index = 0; index < 60; index++) assert.equal(photos.forUser("viewer", "GET", "/v1/progress-photos/id/image"), null);
  assert.equal(photos.forUser("viewer", "GET", "/v1/progress-photos/id/image")?.status, 429);
  assert.equal(photos.forUser("another-viewer", "GET", "/v1/progress-photos/id/image"), null);

  for (let index = 0; index < 64; index++) assert.equal(photos.photoDownload("viewer", 8 * 1024 * 1024), null);
  assert.equal(photos.photoDownload("viewer", 1)?.status, 429);
  assert.equal(photos.photoDownload("another-viewer", 256 * 1024), null);
});

void test("anonymous concurrency is bounded and capacity returns afterward", async () => {
  const app = new Hono();
  const limits = requestLimits(anonymous);
  let finish: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => { finish = resolve; });
  app.use(limits.beforeRequest);
  app.use("/v1/progress-photos", limits.beforeUpload);
  app.get("/v1/test", async (context) => { await wait;

 return context.body(null, 401); });
  const pending = Array.from({ length: 24 }, () => Promise.resolve(app.request("/v1/test")));
  assert.equal((await app.request("/v1/test")).status, 429);
  finish();
  assert.ok((await Promise.all(pending)).every((response) => response.status === 401));
  assert.equal((await app.request("/v1/test")).status, 401);
});

void test("only two large photo uploads can occupy handlers at once", async () => {
  const app = new Hono();
  const limits = requestLimits(anonymous);
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
  const limits = requestLimits(anonymous);
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
  const limits = requestLimits(anonymous);
  const refresh = "/v1/integrations/google-health/refreshes";

  for (let index = 0; index < 30; index++) assert.equal(limits.forUser("reader", "POST", refresh), null);
  assert.equal(limits.forUser("reader", "POST", refresh)?.status, 429);

  // All 120 hourly writes remain after the checks.
  for (let index = 0; index < 120; index++) assert.equal(limits.forUser("reader", "PUT", "/v1/dashboard"), null);
  assert.equal(limits.forUser("reader", "PUT", "/v1/dashboard")?.status, 429);
});

void test("rejected account writes cannot exhaust another account's shared write allowance", () => {
  let time = 0;
  const limits = requestLimits(anonymous, () => time);
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
  const limits = requestLimits(anonymous, () => time);

  for (let index = 0; index < 20; index++) assert.equal(limits.forUser("uploader", "POST", "/v1/progress-photos"), null);

  for (let index = 0; index < 100; index++) assert.equal(limits.forUser("uploader", "POST", "/v1/progress-photos")?.status, 429);
  time += 60_001;

  for (let index = 0; index < 100; index++) assert.equal(limits.forUser("uploader", "PUT", "/v1/targets"), null);
  assert.equal(limits.forUser("uploader", "PUT", "/v1/targets")?.status, 429);
});

void test("forged sessions and anonymous floods cannot lock out a signed-in person", async () => {
  const app = new Hono<CallerVariables>();
  const limits = requestLimits(signedIn);
  let finish: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => { finish = resolve; });
  app.use(limits.beforeRequest);
  app.get("/v1/me", (context) => context.text(context.get("clerkUserId") ?? "nobody"));

  for (let index = 0; index < 600; index++) await app.request("/v1/me", { headers: { Authorization: `Bearer forged-${index}` } });
  assert.equal((await app.request("/v1/me", { headers: { Authorization: "Bearer forged" } })).status, 429);
  const valid = await app.request("/v1/me", { headers: { Authorization: "Bearer valid" } });
  assert.equal(valid.status, 200);
  assert.equal(await valid.text(), "person");

  // Anonymous API requests hold at most 24 handlers, so signed-in requests still find one free.
  const busy = new Hono<CallerVariables>();
  busy.use(requestLimits(signedIn).beforeRequest);
  busy.get("/v1/me", (context) => context.text("ok"));
  busy.get("/v1/slow", async (context) => { await wait;

 return context.text("ok"); });
  const pending = Array.from({ length: 24 }, () => Promise.resolve(busy.request("/v1/slow")));
  assert.equal((await busy.request("/v1/slow")).status, 429);
  assert.equal((await busy.request("/v1/me", { headers: { Authorization: "Bearer valid" } })).status, 200);
  finish();
  assert.ok((await Promise.all(pending)).every((response) => response.status === 200));

  // One signed-in person holds at most 8 uploads, so their slow requests leave room for everyone else. Reads are not
  // capped this way, since a photo grid fetches every thumbnail at once.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const pair = { identify: async (request: Request) => request.headers.get("Authorization")?.slice(7) ?? null };
  const shared = new Hono<CallerVariables>();
  shared.use(requestLimits(pair).beforeRequest);
  shared.post("/v1/slow", async (context) => { await held;

 return context.text("ok"); });
  shared.get("/v1/me", (context) => context.text("ok"));
  const as = (caller: string, method = "GET") => ({ method, headers: { Authorization: `Bearer ${caller}` } });
  const hogging = Array.from({ length: 8 }, () => Promise.resolve(shared.request("/v1/slow", as("hog", "POST"))));
  assert.equal((await shared.request("/v1/slow", as("hog", "POST"))).status, 429);
  assert.equal((await shared.request("/v1/me", as("hog"))).status, 200);
  const otherUpload = shared.request("/v1/slow", as("other", "POST"));
  release();
  assert.equal((await otherUpload).status, 200);
  assert.ok((await Promise.all(hogging)).every((response) => response.status === 200));
  assert.equal((await shared.request("/v1/slow", as("hog", "POST"))).status, 200);

  // The anonymous request budget runs out on its own.
  const flooded = requestLimits(signedIn);
  const quiet = new Hono<CallerVariables>();
  quiet.use(flooded.beforeRequest);
  quiet.get("*", (context) => context.text("ok"));

  for (let index = 0; index < 3000; index++) await quiet.request("/favicon.svg");
  assert.equal((await quiet.request("/favicon.svg")).status, 429);
  assert.equal((await quiet.request("/v1/me", { headers: { Authorization: "Bearer valid" } })).status, 200);
});

void test("a verified MCP token is identified locally for a minute, then checked with Clerk again", async () => {
  let time = 0;
  let clerkChecks = 0;
  const assistant = { clerkUserId: "person", clientId: "claude", revocable: true };

  const identity: Identity = {
    authenticate: async () => null,
    authenticateAgent: async (request) => {
      clerkChecks++;

      return request.headers.get("Authorization") === "Bearer agent" ? assistant : null;
    },
    agentName: async () => null,
    revokeAgent: async () => undefined,
    readWebhook: async () => "forged",
    publishableKey: "pk_test_unused",
  };

  // postgres.js connects on the first query, and identifying a caller makes none.
  const access = accountAccess(drizzle(postgres("postgres://unused@127.0.0.1:1/unused")), identity, () => time);
  const message = (token: string) => new Request("http://nouri.test/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}` } });

  assert.equal(await access.identify(message("agent")), null);
  assert.deepEqual(await access.agent(message("agent")), assistant);
  assert.equal(await access.identify(message("agent")), "person");
  assert.deepEqual(await access.agent(message("agent")), assistant);
  assert.equal(await access.identify(message("other")), null);
  assert.equal(await access.agent(message("other")), null);
  time = 60_001;

  assert.equal(await access.identify(message("agent")), null);
  await access.agent(message("agent"));
  access.forget("person");
  assert.equal(await access.identify(message("agent")), null);

  // A token Nouri refused, such as a disconnected assistant's, is checked with Clerk again.
  await access.agent(message("agent"));
  access.forgetAgent(message("agent"));
  assert.equal(await access.identify(message("agent")), null);
  assert.equal(clerkChecks, 4);
});

void test("barcode answers are remembered, failures are not, and fetches have an app-wide allowance", async () => {
  let time = 0;
  let fetches = 0;
  let answer: PackagedLookup = { outcome: "unavailable" };
  let allowed = 2;

  const upstream = {
    lookup: async () => {
      fetches++;

      return answer;
    },
  };

  const foods = rememberedLookups(upstream, () => allowed-- > 0, () => time);

  assert.equal((await foods.lookup("12345670")).outcome, "unavailable");
  answer = { outcome: "not-found" };
  assert.equal((await foods.lookup("12345670")).outcome, "not-found");
  assert.equal((await foods.lookup("12345670")).outcome, "not-found");
  assert.equal(fetches, 2);

  // Past the allowance, an unremembered barcode reads as unavailable without asking.
  assert.equal((await foods.lookup("96385074")).outcome, "unavailable");
  assert.equal(fetches, 2);
  time = 6 * 60 * 60_000 + 1;

  allowed = 1;
  await foods.lookup("12345670");
  assert.equal(fetches, 3);
});

void test("one account past its share cannot drain the signed-in pool for everyone else", async () => {
  const app = new Hono<CallerVariables>();
  const limits = requestLimits({ identify: async (request) => request.headers.get("Authorization")?.slice(7) ?? null });
  app.use(limits.beforeRequest);
  app.get("/v1/me", (context) => context.text("ok"));

  for (let index = 0; index < 3000; index++) await app.request("/v1/me", { headers: { Authorization: "Bearer greedy" } });
  assert.equal((await app.request("/v1/me", { headers: { Authorization: "Bearer greedy" } })).status, 429);
  assert.equal((await app.request("/v1/me", { headers: { Authorization: "Bearer someone-else" } })).status, 200);
});

void test("requests waiting on identification are bounded before they are counted anywhere else", { timeout: 5000 }, async () => {
  let release: () => void = () => undefined;
  const keysArrive = new Promise<void>((resolve) => { release = resolve; });
  let checks = 0;
  const app = new Hono<CallerVariables>();

  const slowKeys = {
    identify: async () => {
      checks++;
      await keysArrive;

      return null;
    },
  };

  app.use(requestLimits(slowKeys).beforeRequest);
  app.get("/v1/me", (context) => context.body(null, 401));
  const waiting = Array.from({ length: 32 }, () => Promise.resolve(app.request("/v1/me", { headers: { Authorization: "Bearer forged" } })));
  assert.equal((await app.request("/v1/me", { headers: { Authorization: "Bearer forged" } })).status, 429);
  assert.equal(checks, 32);
  release();

  // Released together, the waiting requests meet the 24-handler anonymous share, so some are refused there instead.
  assert.ok((await Promise.all(waiting)).every((response) => [401, 429].includes(response.status)));
  assert.equal((await app.request("/v1/me")).status, 401);
});
