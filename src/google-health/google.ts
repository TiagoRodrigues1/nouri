import type { z } from "zod";
import { activeEnergyRollupSchema, dataPageSchema, exerciseDataPointSchema, heartRateRollupSchema, identitySchema, restingHeartRatePointSchema, rollupPageSchema, scopes, sleepDataPointSchema, stepsRollupSchema, syncWindowDays, tokenErrorSchema, tokenResponseSchema } from "./contract.js";
import type { GoogleHealthConfig, RestingHeartRatePoint } from "./contract.js";
import type { BpmRange } from "../daily-totals/contract.js";
import { activityRecords, heartRateRecords, type DaySeries, type DayValue } from "./daily-import.js";
import { sleepRecord } from "./sleep-import.js";
import { workoutRecord } from "./workout-import.js";
import { googleWebhook } from "./webhook.js";
import { importKinds } from "../wearables/contract.js";
import { ProviderFailure, reauthorizeMessage } from "../wearables/provider.js";
import type { CloudProvider, DayRange, OAuthGrant, Pull } from "../wearables/provider.js";
import { shiftDate } from "../time.js";

// Endpoints from https://developers.google.com/health/migration/data-access and the v4 REST reference.
export const googleEndpoints = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  dataTypes: "https://health.googleapis.com/v4/users/me/dataTypes",
  identity: "https://health.googleapis.com/v4/users/me/identity",
} as const;

const dataPoints = (dataType: string) => `${googleEndpoints.dataTypes}/${dataType}/dataPoints`;

// List pages hold at most 25 points; 40 pages covers far more than the sync window.
const maxPages = 40;

// One bucket per day, so a page covers the longest range one rollup request may ask for.
const rollupPageSize = 90;

// One Google data type as Nouri lists it: how to filter it, and how a point becomes a record.
type DataType<Point, R> = {
  dataType: string;
  // Used in messages, like "sleep" or "workouts".
  noun: string;
  filter: string;
  schema: z.ZodType<Point>;
  toRecord: (point: Point) => R | null;
};

// A Google data type that holds one point per local day, such as the resting heart rate.
type DailyType<Point, V> = {
  dataType: string;
  noun: string;
  filter: (days: DayRange) => string;
  schema: z.ZodType<Point>;
  toDay: (point: Point) => DayValue<V>;
};

// One Google data type as Nouri reads it in daily totals. Google caps how many days one request may cover.
type RollupType<V> = {
  dataType: string;
  noun: string;
  maxDays: number;
  // Null when the day has no value.
  schema: z.ZodType<V | null>;
};

async function send(config: GoogleHealthConfig, url: string, init: RequestInit): Promise<Response> {
  try {
    return await config.fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new ProviderFailure("unavailable", "Could not reach Google. Check your connection and choose Sync again.");
  }
}

async function tokenRequest(config: GoogleHealthConfig, body: Record<string, string>): Promise<OAuthGrant> {
  const response = await send(config, googleEndpoints.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...body }),
  });

  const json: unknown = await response.json().catch(() => null);

  if (response.ok) {
    const grant = tokenResponseSchema.safeParse(json);

    if (!grant.success) throw new ProviderFailure("unavailable", "Google returned an unexpected sign-in response. Choose Connect to try again.");
    const { access_token, refresh_token, expires_in, scope } = grant.data;

    return { accessToken: access_token, refreshToken: refresh_token ?? null, expiresInSeconds: expires_in, scope };
  }

  const failure = tokenErrorSchema.safeParse(json);

  // invalid_grant covers expired and revoked grants, and Testing-mode refresh tokens after 7 days.
  if (failure.success && (failure.data.error === "invalid_grant" || failure.data.error === "unauthorized_client")) throw new ProviderFailure("reauthorize", reauthorizeMessage);

  if (failure.success && failure.data.error === "invalid_client") throw new ProviderFailure("unavailable", "Google rejected Nouri's OAuth client. Check GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET.");

  throw new ProviderFailure("unavailable", `Google sign-in failed (${response.status}). Try again in a few minutes.`);
}

// Reads one page of a data type, turning Google's refusals into messages for the person.
async function readPage<Body>(config: GoogleHealthConfig, accessToken: string, noun: string, request: { url: string; body?: string }, schema: z.ZodType<Body>): Promise<Body> {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

  const response = await send(config, request.url, request.body === undefined
    ? { headers }
    : { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: request.body });

  if (response.status === 401) throw new ProviderFailure("unauthorized", reauthorizeMessage);

  if (response.status === 403) throw new ProviderFailure("reauthorize", `Google Health did not allow Nouri to read ${noun}. Choose Connect and allow ${noun} access.`);

  if (response.status === 429) throw new ProviderFailure("unavailable", "Google Health is limiting requests. Wait a few minutes, then choose Sync again.");

  if (!response.ok) throw new ProviderFailure("unavailable", `Google Health could not return ${noun} data (${response.status}). Try again later.`);

  const body = schema.safeParse(await response.json().catch(() => null));

  if (!body.success) throw new ProviderFailure("unavailable", `Google Health returned ${noun} data Nouri could not read. Try again later.`);

  return body.data;
}

type Page<Item> = { items: Item[]; nextPageToken: string | undefined };

// Follows page tokens to the last page. A read cut off at maxPages is incomplete, so it deletes nothing.
async function allPages<Item>(read: (pageToken: string | undefined) => Promise<Page<Item>>): Promise<{ items: Item[]; complete: boolean }> {
  const items: Item[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const next = await read(pageToken);

    items.push(...next.items);
    pageToken = next.nextPageToken || undefined;

    if (!pageToken) return { items, complete: true };
  }

  return { items, complete: false };
}

// Every point of a data type the filter matches, as Google sent them.
function listPoints(config: GoogleHealthConfig, accessToken: string, dataType: string, noun: string, filter: string) {
  return allPages(async (pageToken) => {
    const url = new URL(dataPoints(dataType));

    url.searchParams.set("filter", filter);
    url.searchParams.set("pageSize", "25");

    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = await readPage(config, accessToken, noun, { url: url.toString() }, dataPageSchema);

    return { items: body.dataPoints, nextPageToken: body.nextPageToken };
  });
}

// Lists the sessions the filter matches.
async function pullPoints<Point, R>(config: GoogleHealthConfig, accessToken: string, type: DataType<Point, R>): Promise<Pull<R>> {
  const { items, complete } = await listPoints(config, accessToken, type.dataType, type.noun, type.filter);
  const records: R[] = [];

  // Each point is parsed on its own, so one odd session does not stop the rest.
  for (const raw of items) {
    const point = type.schema.safeParse(raw);
    const record = point.success ? type.toRecord(point.data) : null;

    if (record) records.push(record);
  }

  return { records, skipped: items.length - records.length, complete };
}

// A day's totals are read whole, unlike sessions: dropping a day Nouri cannot read would delete or blank one already stored.
const unreadable = (noun: string) => new ProviderFailure("unavailable", `Google Health returned ${noun} data Nouri could not read. Try again later.`);

// Lists a data type that holds one point per local day.
async function listDays<Point, V>(config: GoogleHealthConfig, accessToken: string, days: DayRange, type: DailyType<Point, V>): Promise<DaySeries<V>> {
  const { items, complete } = await listPoints(config, accessToken, type.dataType, type.noun, type.filter(days));

  const values = items.map((raw) => {
    const point = type.schema.safeParse(raw);

    if (!point.success) throw unreadable(type.noun);

    return type.toDay(point.data);
  });

  return { days: values, complete };
}

// A civil date at midnight, as dailyRollUp takes range bounds.
function civilMidnight(date: string) {
  const [year, month, day] = date.split("-").map(Number);

  return { date: { year, month, day }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } };
}

// Splits the range into pieces no longer than Google allows for one request.
function pieces(days: DayRange, maxDays: number): DayRange[] {
  const ranges: DayRange[] = [];

  for (let from = days.from; from < days.until; from = shiftDate(from, maxDays)) {
    const end = shiftDate(from, maxDays);

    ranges.push({ from, until: end < days.until ? end : days.until });
  }

  return ranges;
}

// Adds up a data type per local day across the range.
async function rollUp<V>(config: GoogleHealthConfig, accessToken: string, days: DayRange, type: RollupType<V>): Promise<DaySeries<V>> {
  const reads = await Promise.all(pieces(days, type.maxDays).map((range) => allPages(async (pageToken) => {
    const body = JSON.stringify({ range: { start: civilMidnight(range.from), end: civilMidnight(range.until) }, windowSizeDays: 1, pageSize: rollupPageSize, pageToken });
    const page = await readPage(config, accessToken, type.noun, { url: `${dataPoints(type.dataType)}:dailyRollUp`, body }, rollupPageSchema);

    return { items: page.rollupDataPoints, nextPageToken: page.nextPageToken };
  })));

  const values: DayValue<V>[] = [];

  for (const bucket of reads.flatMap((read) => read.items)) {
    const value = type.schema.safeParse(bucket);

    if (!value.success) throw unreadable(type.noun);

    // A day without data has no value.
    if (value.data !== null) values.push({ localDate: bucket.civilStartTime.date, value: value.data });
  }

  return { days: values, complete: reads.every((read) => read.complete) };
}

const steps: RollupType<number> = { dataType: "steps", noun: "steps", maxDays: 90, schema: stepsRollupSchema };

const activeEnergy: RollupType<number> = { dataType: "active-energy-burned", noun: "active energy", maxDays: 90, schema: activeEnergyRollupSchema };

// Heart rate is kept at one-second resolution, so Google rolls up at most 14 days of it per request.
const heartRate: RollupType<BpmRange> = { dataType: "heart-rate", noun: "heart rate", maxDays: 14, schema: heartRateRollupSchema };

const restingHeartRate: DailyType<RestingHeartRatePoint, number> = {
  dataType: "daily-resting-heart-rate", noun: "heart rate", schema: restingHeartRatePointSchema,
  filter: (days) => `daily_resting_heart_rate.date >= "${days.from}"`,
  toDay: ({ dailyRestingHeartRate: resting }) => ({ localDate: resting.date, value: resting.beatsPerMinute }),
};

export function googleHealthProvider(config: GoogleHealthConfig): CloudProvider {
  return {
    id: "google-health",
    windowDays: syncWindowDays,
    callbackOrigin: new URL(config.redirectUri).origin,
    authorizationUrl: (state, codeChallenge) => {
      const url = new URL(googleEndpoints.authorize);

      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        // Several kinds share a scope, so each is asked for once.
        scope: [...new Set(importKinds.map((kind) => scopes[kind]))].join(" "),
        // Offline access returns a refresh token, so Sync works after the hour-long access token ends.
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "false",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }).toString();

      return url.toString();
    },
    exchangeCode: (code, codeVerifier) => tokenRequest(config, { grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: config.redirectUri }),
    refresh: (refreshToken) => tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken }),
    grantedKinds: (scope) => importKinds.filter((kind) => scope.split(" ").includes(scopes[kind])),
    // Revoking the refresh token also ends its access tokens. A failure leaves the grant in Google's account settings.
    revoke: async (token) => {
      const response = await send(config, googleEndpoints.revoke, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      }).catch(() => null);

      return response?.ok ?? false;
    },
    // Any of Nouri's read scopes may read the identity.
    accountId: async (accessToken) => (await readPage(config, accessToken, "your account", { url: googleEndpoints.identity }, identitySchema)).healthUserId,
    webhook: config.webhookSecret ? googleWebhook(config.webhookSecret) : null,
    pull: {
      sleep: (accessToken, window) => pullPoints(config, accessToken, {
        dataType: "sleep", noun: "sleep", schema: sleepDataPointSchema, toRecord: sleepRecord,
        filter: `sleep.interval.end_time >= "${window.endedSince.toISOString()}"`,
      }),
      // Exercise only filters on civil start time, a local date without an offset.
      workouts: (accessToken, window) => pullPoints(config, accessToken, {
        dataType: "exercise", noun: "workouts", schema: exerciseDataPointSchema, toRecord: workoutRecord,
        filter: `exercise.interval.civil_start_time >= "${window.days.from}"`,
      }),
      activity: async (accessToken, window) => activityRecords(...await Promise.all([
        rollUp(config, accessToken, window.days, steps),
        rollUp(config, accessToken, window.days, activeEnergy),
      ])),
      heartRate: async (accessToken, window) => heartRateRecords(...await Promise.all([
        rollUp(config, accessToken, window.days, heartRate),
        listDays(config, accessToken, window.days, restingHeartRate),
      ])),
    },
  };
}
