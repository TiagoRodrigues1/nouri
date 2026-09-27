import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { googleEndpoints } from "../google-health/google.js";

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

const bothScopes = "https://www.googleapis.com/auth/googlehealth.sleep.readonly https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";

export function fixture(name: string): Fixture {
  return pointSchema.parse(JSON.parse(readFileSync(new URL(`../google-health/fixtures/${name}.json`, import.meta.url), "utf8")));
}

function json(status: number, body: Fixture | Record<string, string | number | Fixture[] | undefined>): Response {
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
  // Small pages make every sync follow nextPageToken.
  pageSize = 2;
  outage = false;
  // Space-separated, as Google returns it; tests narrow it to model unticked boxes on the consent screen.
  grantedScope = bothScopes;
  readonly requests: URL[] = [];
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

    if (url.href.startsWith(googleEndpoints.sleep)) return this.list(url, headers.get("Authorization"), "sleep");

    if (url.href.startsWith(googleEndpoints.exercise)) return this.list(url, headers.get("Authorization"), "exercise");

    return json(404, { error: "not found" });
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

  private list(url: URL, authorization: string | null, dataType: "sleep" | "exercise"): Response {
    if (!authorization?.startsWith("Bearer ") || !this.accessTokens.has(authorization.slice(7))) return json(401, { error: "UNAUTHENTICATED" });

    if (this.outage) return json(503, { error: "UNAVAILABLE" });

    // Sleep filters on the physical end time; exercise only on the civil start time.
    const filter = url.searchParams.get("filter") ?? "";
    const since = dataType === "sleep" ? /^sleep\.interval\.end_time >= "(.+)"$/.exec(filter)?.[1] : /^exercise\.interval\.civil_start_time >= "(\d{4}-\d{2}-\d{2})"$/.exec(filter)?.[1];

    if (!since) return json(400, { error: "INVALID_ARGUMENT" });

    // Like Google, a data type answers only with the scope that covers it.
    if (!this.grantedScope.split(" ").includes(dataType === "sleep" ? "https://www.googleapis.com/auth/googlehealth.sleep.readonly" : "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly")) return json(403, { error: "PERMISSION_DENIED" });

    const inWindow = (point: Fixture) => dataType === "sleep" ? Date.parse(session(point).interval.endTime) >= Date.parse(since) : civilStart(point) >= since;

    const matching = [...this.points.values()]
      .filter((point) => point[dataType] !== undefined && inWindow(point))
      .sort((a, b) => Date.parse(session(b).interval.startTime) - Date.parse(session(a).interval.startTime));

    const offset = Number(url.searchParams.get("pageToken") ?? 0);
    const next = offset + this.pageSize;

    return json(200, { dataPoints: matching.slice(offset, next), nextPageToken: next < matching.length ? String(next) : undefined });
  }
}
