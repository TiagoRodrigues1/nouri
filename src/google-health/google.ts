import type { z } from "zod";
import { dataPageSchema, exerciseDataPointSchema, scopes, sleepDataPointSchema, syncWindowDays, tokenErrorSchema, tokenResponseSchema } from "./contract.js";
import type { GoogleHealthConfig } from "./contract.js";
import { sleepRecord } from "./sleep-import.js";
import { workoutRecord } from "./workout-import.js";
import { importKinds } from "../wearables/contract.js";
import { ProviderFailure, reauthorizeMessage } from "../wearables/provider.js";
import type { CloudProvider, OAuthGrant, Pull } from "../wearables/provider.js";

// Endpoints from https://developers.google.com/health/migration/data-access and the v4 REST reference.
export const googleEndpoints = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  sleep: "https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints",
  exercise: "https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints",
} as const;

// Sleep and exercise pages hold at most 25 points; 40 pages covers far more sessions than the sync window.
const maxPages = 40;

// One Google data type as Nouri reads it: where it lives, how to filter it, and how a point becomes a record.
type DataType<Point, R> = {
  url: string;
  // Used in messages, like "sleep" or "workouts".
  noun: string;
  filter: string;
  schema: z.ZodType<Point>;
  toRecord: (point: Point) => R | null;
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

// Lists every data point the filter matches, following page tokens.
async function pullPoints<Point, R>(config: GoogleHealthConfig, accessToken: string, type: DataType<Point, R>): Promise<Pull<R>> {
  const records: R[] = [];
  let skipped = 0;
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(type.url);

    url.searchParams.set("filter", type.filter);
    url.searchParams.set("pageSize", "25");

    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await send(config, url.toString(), { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });

    if (response.status === 401) throw new ProviderFailure("unauthorized", reauthorizeMessage);

    if (response.status === 403) throw new ProviderFailure("reauthorize", `Google Health did not allow Nouri to read ${type.noun}. Choose Connect and allow ${type.noun} access.`);

    if (response.status === 429) throw new ProviderFailure("unavailable", "Google Health is limiting requests. Wait a few minutes, then choose Sync again.");

    if (!response.ok) throw new ProviderFailure("unavailable", `Google Health could not return ${type.noun} data (${response.status}). Try again later.`);

    const body = dataPageSchema.safeParse(await response.json().catch(() => null));

    if (!body.success) throw new ProviderFailure("unavailable", `Google Health returned ${type.noun} data Nouri could not read. Try again later.`);

    // Each point is parsed on its own, so one odd record does not stop the rest.
    for (const raw of body.data.dataPoints) {
      const point = type.schema.safeParse(raw);
      const record = point.success ? type.toRecord(point.data) : null;

      if (record) records.push(record);
      else skipped += 1;
    }

    pageToken = body.data.nextPageToken || undefined;

    if (!pageToken) return { records, skipped, complete: true };
  }

  return { records, skipped, complete: false };
}

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
        scope: importKinds.map((kind) => scopes[kind]).join(" "),
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
    pull: {
      sleep: (accessToken, window) => pullPoints(config, accessToken, {
        url: googleEndpoints.sleep, noun: "sleep", schema: sleepDataPointSchema, toRecord: sleepRecord,
        filter: `sleep.interval.end_time >= "${window.endedSince.toISOString()}"`,
      }),
      // Exercise only filters on civil start time, a local date without an offset.
      workouts: (accessToken, window) => pullPoints(config, accessToken, {
        url: googleEndpoints.exercise, noun: "workouts", schema: exerciseDataPointSchema, toRecord: workoutRecord,
        filter: `exercise.interval.civil_start_time >= "${window.startedOnOrAfter}"`,
      }),
    },
  };
}
