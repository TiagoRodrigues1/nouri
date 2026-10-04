import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { googleEndpoints } from "../src/google-health/google.js";

const clientId = "nouri-test.apps.googleusercontent.com";

const clientSecret = "test-client-secret";

const defaultRedirectUri = "http://127.0.0.1:3000/oauth/google-health/callback";

export const googleConfig = { clientId, clientSecret, redirectUri: defaultRedirectUri };

const sessionSchema = z.object({ interval: z.object({ startTime: z.string(), startUtcOffset: z.string().optional(), endTime: z.string() }).loose() }).loose();

// A sleep point carries `sleep`, an exercise point `exercise`.
const pointSchema = z.object({ name: z.string(), sleep: sessionSchema.optional(), exercise: sessionSchema.optional() })
  .loose().refine((point) => (point.sleep === undefined) !== (point.exercise === undefined));

export type Fixture = z.infer<typeof pointSchema>;

function session(point: Fixture) {
  const found = point.sleep ?? point.exercise;

  if (!found) throw new Error(`${point.name} is neither sleep nor exercise`);

  return found;
}

// The local wall-clock start, which is what Google's civil_start_time filter compares.
function civilStart(point: Fixture): string {
  const { startTime, startUtcOffset } = session(point).interval;

  return new Date(Date.parse(startTime) + Number((startUtcOffset ?? "0s").slice(0, -1)) * 1000).toISOString().slice(0, 19);
}

export const googleScopes = {
  sleep: "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  activity: "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  health: "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
} as const;

// The scope that covers each data type, from https://developers.google.com/health/scopes.
const scopeOf = new Map<string, string>([
  ["sleep", googleScopes.sleep],
  ["exercise", googleScopes.activity],
  ["steps", googleScopes.activity],
  ["active-energy-burned", googleScopes.activity],
  ["heart-rate", googleScopes.health],
  ["daily-resting-heart-rate", googleScopes.health],
]);

// dailyRollUp covers at most 14 days of these per request and 90 days of the others.
const shortRollups = new Set(["heart-rate", "calories-in-heart-rate-zone", "active-minutes", "total-calories"]);

// One local day of totals, as a wearable would report it. A missing field is a day without that data.
export type FakeDay = { steps?: number; activeKcal?: number; heartRate?: { average: number; min: number; max: number }; restingBpm?: number };

// Each rollup's value field for a day, or nothing when the day has no data. int64 values travel as strings.
const rollupValues = new Map<string, (day: FakeDay) => { [field: string]: { [key: string]: string | number } } | null>([
  ["steps", (day) => day.steps === undefined ? null : { steps: { countSum: String(day.steps) } }],
  ["active-energy-burned", (day) => day.activeKcal === undefined ? null : { activeEnergyBurned: { kcalSum: day.activeKcal } }],
  ["heart-rate", (day) => day.heartRate ? { heartRate: { beatsPerMinuteAvg: day.heartRate.average, beatsPerMinuteMin: day.heartRate.min, beatsPerMinuteMax: day.heartRate.max } } : null],
]);

const civilDateSchema = z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() });

const midnightSchema = z.object({ date: civilDateSchema, time: z.object({ hours: z.literal(0), minutes: z.literal(0), seconds: z.literal(0), nanos: z.literal(0) }).partial() });

const rollupRequestSchema = z.object({ range: z.object({ start: midnightSchema, end: midnightSchema }), windowSizeDays: z.literal(1), pageToken: z.string().optional() });

const isoDate = ({ year, month, day }: z.infer<typeof civilDateSchema>) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function civil(date: string) {
  const [year, month, day] = date.split("-").map(Number);

  return { year, month, day };
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);

  next.setUTCDate(next.getUTCDate() + 1);

  return next.toISOString().slice(0, 10);
}

const allScopes = Object.values(googleScopes).join(" ");

export function fixture(name: string): Fixture {
  return pointSchema.parse(JSON.parse(readFileSync(new URL(`../src/google-health/fixtures/${name}.json`, import.meta.url), "utf8")));
}

type Json = string | number | boolean | null | undefined | Json[] | { [key: string]: Json };

function json(status: number, body: Json | { dataPoints: Fixture[]; nextPageToken: string | undefined }): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Stands in for Google's OAuth and Health endpoints with the documented request and response shapes.
// It checks PKCE, the redirect URI, and client credentials the way Google does.
const codePrefix = "4/fake-approved-";

function approvalCode(authorizationUrl: string): string {
  return `${codePrefix}${new URL(authorizationUrl).searchParams.get("code_challenge") ?? ""}`;
}

export class FakeGoogle {
  constructor(readonly redirectUri = defaultRedirectUri) {}

  points = new Map<string, Fixture>();
  // Daily totals by local date, read through dailyRollUp and the daily resting heart rate list.
  days = new Map<string, FakeDay>();
  // Small pages make every sync follow nextPageToken.
  pageSize = 2;
  outage = false;
  // Makes every steps bucket, or every resting heart rate, carry a value Nouri cannot read, as if Google changed its format.
  unreadableSteps = false;
  unreadableResting = false;
  // Makes steps rollups always offer another page, so a sync stops at its page cap.
  endlessSteps = false;
  // Space-separated, as Google returns it; tests narrow it to model unticked boxes on the consent screen.
  grantedScope = allScopes;
  readonly requests: URL[] = [];
  // The data type and date range of each dailyRollUp, once per range however many pages it takes.
  readonly rollups: { dataType: string; from: string; until: string }[] = [];
  readonly revoked: string[] = [];
  private readonly usedCodes = new Set<string>();
  private readonly accessTokens = new Set<string>();
  private refreshToken: string | null = null;
  private issued = 0;

  // What Google does after the person signs in and approves: send the browser back with a code.
  // The code carries the PKCE challenge, so a browser run can approve without calling into the fake.
  approve(authorizationUrl: string) {
    const url = new URL(authorizationUrl);

    return { state: url.searchParams.get("state") ?? "", code: approvalCode(authorizationUrl) } satisfies { state: string; code: string };
  }

  put(point: Fixture): void {
    this.points.set(point.name, point);
  }

  // Makes every access token fail, as when one expires or Google invalidates it early.
  expireAccessTokens(): void {
    this.accessTokens.clear();
  }

  // As when the person removes Nouri in their Google Account, or a Testing-mode refresh token passes 7 days.
  revokeGrant(): void {
    this.refreshToken = null;
    this.accessTokens.clear();
  }

  get currentRefreshToken(): string | null {
    return this.refreshToken;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const headers = new Headers(init?.headers);
    const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams();

    this.requests.push(url);

    if (url.href.startsWith(googleEndpoints.token)) return this.token(body);

    if (url.href.startsWith(googleEndpoints.revoke)) {
      const token = body.get("token") ?? "";

      this.revoked.push(token);

      if (token === this.refreshToken) this.revokeGrant();

      return new Response(null, { status: 200 });
    }

    const dataPoints = new RegExp(`^${googleEndpoints.dataTypes}/([a-z-]+)/dataPoints(:dailyRollUp)?$`).exec(url.origin + url.pathname);
    const dataType = dataPoints?.[1];

    if (!dataType || !scopeOf.has(dataType)) return json(404, { error: "not found" });

    if (!headers.get("Authorization")?.startsWith("Bearer ") || !this.accessTokens.has(headers.get("Authorization")?.slice(7) ?? "")) return json(401, { error: "UNAUTHENTICATED" });

    if (this.outage) return json(503, { error: "UNAVAILABLE" });

    // Like Google, a data type answers only with the scope that covers it.
    if (!this.grantedScope.split(" ").includes(scopeOf.get(dataType) ?? "")) return json(403, { error: "PERMISSION_DENIED" });

    if (dataPoints[2]) {
      const body = z.string().safeParse(init?.body);

      return init?.method === "POST" && body.success ? this.rollUp(dataType, body.data) : json(400, { error: "INVALID_ARGUMENT" });
    }

    return dataType === "daily-resting-heart-rate" ? this.restingHeartRate(url) : this.list(url, dataType);
  };

  private accessToken(): string {
    const token = `ya29.fake-access-${++this.issued}`;

    this.accessTokens.add(token);

    return token;
  }

  private token(body: URLSearchParams): Response {
    if (body.get("client_id") !== clientId || body.get("client_secret") !== clientSecret) return json(401, { error: "invalid_client" });

    if (body.get("grant_type") === "authorization_code") {
      const code = body.get("code") ?? "";
      const challenge = code.startsWith(codePrefix) ? code.slice(codePrefix.length) : null;
      const verifier = body.get("code_verifier") ?? "";

      // Like Google, a code works once and only with the verifier behind its challenge.
      if (!challenge || this.usedCodes.has(code) || body.get("redirect_uri") !== this.redirectUri || createHash("sha256").update(verifier).digest("base64url") !== challenge) return json(400, { error: "invalid_grant" });
      this.usedCodes.add(code);
      this.refreshToken = `1//fake-refresh-${++this.issued}`;

      return json(200, { access_token: this.accessToken(), expires_in: 3599, refresh_token: this.refreshToken, scope: this.grantedScope, token_type: "Bearer" });
    }

    if (body.get("grant_type") === "refresh_token" && this.refreshToken !== null && body.get("refresh_token") === this.refreshToken) {
      return json(200, { access_token: this.accessToken(), expires_in: 3599, scope: this.grantedScope, token_type: "Bearer" });
    }

    return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
  }

  private list(url: URL, dataType: string): Response {
    if (dataType !== "sleep" && dataType !== "exercise") return json(400, { error: "INVALID_ARGUMENT" });

    // Sleep filters on the physical end time; exercise only on the civil start time.
    const filter = url.searchParams.get("filter") ?? "";
    const since = dataType === "sleep" ? /^sleep\.interval\.end_time >= "(.+)"$/.exec(filter)?.[1] : /^exercise\.interval\.civil_start_time >= "(\d{4}-\d{2}-\d{2})"$/.exec(filter)?.[1];

    if (!since) return json(400, { error: "INVALID_ARGUMENT" });

    const inWindow = (point: Fixture) => dataType === "sleep" ? Date.parse(session(point).interval.endTime) >= Date.parse(since) : civilStart(point) >= since;

    const matching = [...this.points.values()]
      .filter((point) => point[dataType] !== undefined && inWindow(point))
      .sort((a, b) => Date.parse(session(b).interval.startTime) - Date.parse(session(a).interval.startTime));

    const { items, nextPageToken } = this.page(matching, url.searchParams.get("pageToken"));

    return json(200, { dataPoints: items, nextPageToken });
  }

  private page<T>(items: T[], pageToken: string | null | undefined) {
    const offset = Number(pageToken ?? 0);
    const next = offset + this.pageSize;

    return { items: items.slice(offset, next), nextPageToken: next < items.length ? String(next) : undefined };
  }

  // One bucket per local day in the range. A day without data carries no value, as Google documents.
  private rollUp(dataType: string, body: string): Response {
    const value = rollupValues.get(dataType);
    const request = rollupRequestSchema.safeParse(JSON.parse(body));

    if (!value || !request.success) return json(400, { error: "INVALID_ARGUMENT" });
    const from = isoDate(request.data.range.start.date);
    const until = isoDate(request.data.range.end.date);
    const lengthDays = (Date.parse(until) - Date.parse(from)) / 86_400_000;

    if (!(lengthDays > 0) || lengthDays > (shortRollups.has(dataType) ? 14 : 90)) return json(400, { error: "INVALID_ARGUMENT" });

    if (!request.data.pageToken) this.rollups.push({ dataType, from, until });
    const buckets: Json[] = [];

    for (let date = from; date < until; date = nextDay(date)) {
      const day = this.days.get(date);

      const reported = this.unreadableSteps && dataType === "steps" ? { steps: { countSum: "many" } } : day ? value(day) : null;

      buckets.push({ civilStartTime: { date: civil(date), time: {} }, civilEndTime: { date: civil(nextDay(date)), time: {} }, ...reported });
    }

    const { items, nextPageToken } = this.page(buckets, request.data.pageToken);
    const more = this.endlessSteps && dataType === "steps" ? String(Number(request.data.pageToken ?? 0) + this.pageSize) : nextPageToken;

    return json(200, { rollupDataPoints: items, nextPageToken: more });
  }

  private restingHeartRate(url: URL): Response {
    const since = /^daily_resting_heart_rate\.date >= "(\d{4}-\d{2}-\d{2})"$/.exec(url.searchParams.get("filter") ?? "")?.[1];

    if (!since) return json(400, { error: "INVALID_ARGUMENT" });

    const points = [...this.days].flatMap(([date, day]) => date >= since && day.restingBpm !== undefined ? [{
      name: `users/4f7c2a/dataTypes/daily-resting-heart-rate/dataPoints/${date.replaceAll("-", "")}`,
      dailyRestingHeartRate: { date: civil(date), beatsPerMinute: this.unreadableResting ? "many" : String(day.restingBpm), dailyRestingHeartRateMetadata: { calculationMethod: "WITH_SLEEP" } },
    }] : []);

    const { items, nextPageToken } = this.page(points, url.searchParams.get("pageToken"));

    return json(200, { dataPoints: items, nextPageToken });
  }
}
