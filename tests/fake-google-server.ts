// Runs the real Nouri app with Google's and Open Food Facts' HTTP boundaries replaced by fakes and the checked-in fixtures.
// For browser verification only: a sync here proves Nouri's handling of fixtures, not a live Google connection.
import { serve } from "@hono/node-server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { createApp } from "../src/app.js";
import { oauthCallbackPath } from "../src/wearables/provider.js";
import { wearablesFromEnv } from "../src/google-health/config.js";
import { identityFromEnv } from "../src/identity/identity.js";
import { openFoodFacts } from "../src/food/packaged.js";
import { FakeGoogle, fixture, googleConfig } from "./fake-google.js";
import { FakeOpenFoodFacts } from "./fake-open-food-facts.js";

const settings = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int(),
}).parse(process.env);

const redirectUri = `http://127.0.0.1:${settings.PORT}${oauthCallbackPath("google-health")}`;

const google = new FakeGoogle(redirectUri);

for (const name of ["sleep-night", "sleep-nap", "sleep-too-long", "exercise-run", "exercise-weights", "exercise-too-short"]) google.put(fixture(name));

const wearables = wearablesFromEnv({ GOOGLE_HEALTH_CLIENT_ID: googleConfig.clientId, GOOGLE_HEALTH_CLIENT_SECRET: googleConfig.clientSecret, GOOGLE_HEALTH_REDIRECT_URI: redirectUri, WEARABLE_TOKEN_KEY: Buffer.alloc(32, 9).toString("hex") }, google.fetch);

serve({ fetch: createApp(drizzle(postgres(settings.DATABASE_URL)), identityFromEnv(process.env), openFoodFacts(new FakeOpenFoodFacts().fetch), wearables).fetch, port: settings.PORT, hostname: "127.0.0.1" });
