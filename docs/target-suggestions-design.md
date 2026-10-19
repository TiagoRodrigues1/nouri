# Suggested targets

## Problem

The targets form starts from FDA reference values for a 2,000 kcal diet. Those values suit almost nobody exactly, and working out an energy and protein target by hand means looking up a formula. This slice suggests nutrition targets from a short profile (sex, age, activity level) and a goal direction (lose, maintain, or gain), using the latest weight and height already logged as measurements.

`targets-design.md` left two open questions that this answers: a `profile` beside `targets`, and a goal direction that is independent of the goal weight. Constraints from the existing system:

- Targets are effective-dated, and saving them is a separate, deliberate act that applies from today. A suggestion must never save targets by itself.
- Weight and height live in `body_measurements` and carry forward. The server already finds "the latest of each kind on or before a day" for the measurement summary.
- Formulas belong on the server. `targets-design.md` moved the defaults out of the web app so that a native client would not have to copy them, and the same reasoning applies here.
- Account export and erasure find every table through its foreign key to `users`, so a new table only needs that key.

## Usage (caller's view)

```http
GET /v1/profile/2026-10-17
→ 200 { "profile": null, "suggestion": null, "missing": ["profile"] }

PUT /v1/profile/2026-10-17
{ "sex": "female", "birthYear": 1992, "activity": "moderate", "goal": "lose" }
→ 200 { "profile": { … },
        "suggestion": { "basis": { "age": 34, "weightKg": 68, "heightCm": 168, "maintenanceKcal": 2170 },
                        "targets": { "kcal": 1730, "proteinG": 136, "carbsG": 166, "fatG": 58, "waterMl": 2400 } },
        "missing": [] }
```

With no height logged, the same `PUT` saves the profile and returns `"suggestion": null, "missing": ["height"]`.

In the web app, the targets dialog has a "Suggest from profile" section above the form:

```tsx
const profile = useProfileQuery(today, open);   // the saved profile and the suggestion for today
const save = useSaveProfile(today);
save.mutate(draftProfile, {
  onSuccess: ({ suggestion }) => suggestion && setDraft({ ...draft, ...draftFrom(suggestion.targets) }),
});
// The person reviews the filled-in numbers and presses "Save targets" as before.
```

## Shape

```ts
// src/profile/contract.ts
sexes = ["female", "male"]
activityLevels = ["sedentary", "light", "moderate", "active", "very-active"]
goalDirections = ["lose", "maintain", "gain"]
profileSchema = z.object({ sex, birthYear, activity, goal }).strict()
suggestedTargetsSchema = targetsSchema.pick({ kcal, proteinG, carbsG, fatG, waterMl })
profileViewSchema = z.object({
  profile: profileSchema | null,
  suggestion: { basis: { age, weightKg, heightCm, maintenanceKcal }, targets: SuggestedTargets } | null,
  missing: ("profile" | "age" | "weight" | "height")[],   // empty exactly when there is a suggestion
})

// src/profile/suggest.ts: pure, unit tested
suggestTargets(profile, body: { weightKg, heightCm }, date): Suggestion

// src/profile/profile.ts
getProfileView(db, userId, date): Promise<ProfileView>
saveProfile(db, userId, date, profile): Promise<ProfileView>      // upsert on user_id, then the view

// src/measurements/measurements.ts: extracted from getMeasurementSummary
getLatestMeasurements(db, userId, date): Promise<MeasurementSummary["latest"]>

// frontend/src/lib/use-profile.ts
useProfileQuery(date, enabled), useSaveProfile(date)   // saving writes the returned view into the cache
```

The table is `user_profiles (user_id PRIMARY KEY, sex, birth_year, activity, goal, updated_at)`, one row per person, with `CHECK`s that match the enums.

Load-bearing decisions:

- **The profile is a current setting, not effective-dated.** Targets are dated because past days are judged against them. Nothing is judged against a profile. It only feeds a suggestion the person then saves as dated targets, so a single row like `dashboard_layouts` is enough.
- **One view answers "what would you suggest today?"** The response carries the profile, the suggestion, and what is missing. The date is in the path because both age and the latest weight depend on the day. Saving returns the same view, so the client fills the form from one request instead of saving and then reading. Callers do not see the formula, the measurement lookup, the age arithmetic, rounding, or clamping to `targetLimits`.
- **The profile stores birth year, not age.** A stored age goes stale. The form still asks for age and converts it, so the person never types a year.
- **Only nutrition targets are suggested.** Energy, protein, carbs, fat, and water follow from body size and goal. Sleep, fasting, steps, and the activity goals are preferences, and the weight goal is the person's choice, so those fields in the form stay as they are.
- **A suggestion never saves targets.** It fills the form, and "Save targets" still applies from today, per `targets-design.md`.

The formula is Mifflin–St Jeor resting energy multiplied by a standard activity factor (1.2 to 1.9). Lose takes 20% off maintenance but never goes below resting energy. Gain adds 10%. Protein is grams per kilogram by goal (2.0 lose, 1.6 maintain, 1.8 gain), capped at 35% of energy so a short, heavy person on a cut still has room for carbs. Fat is 30% of energy, carbs fill the rest, and water is 35 ml per kilogram. Every value is rounded and clamped to `targetLimits`, so a suggestion always passes `targetsSchema`.

## Synthesis decision

I compared two structurally different candidates.

- **A: client-side calculator, nothing stored.** A pure function shared with the web app fills the form from a profile typed into the dialog and from the weight and height in the Overview query. The server would need no new code, but the profile would be typed in again on every visit, the targets dialog would depend on the Overview query, and a native client or the MCP server would have to copy the formula.
- **B: a stored profile and a server-side suggestion view.** The profile has its own table, and `GET`/`PUT /v1/profile/{date}` return the profile, the suggestion, and what is missing.

B is the base. It keeps formulas on the server, as `targets-design.md` requires, and gives the open "goal direction" question a home. From A it keeps the pure `suggestTargets` function, which holds every number and is unit tested without a database, and the rule that a suggestion only fills the form. An earlier version of B had a separate `GET /v1/targets/{date}/suggestion`. The client would then have had to save the profile and read the suggestion as two coordinated calls, so the suggestion moved into the profile's own response.

## Tradeoffs accepted

- We accept a date in the path of a resource that is not effective-dated, in exchange for a single read that includes age and the weight in force that day.
- We accept a one-year error in age around birthdays in exchange for never asking for a birth date. It changes resting energy by 5 kcal.
- We accept that the profile records only `female` and `male`, because the formula has no other branch. The section says it uses these for the energy formula.
- We accept formulas for adults only. Saving a profile is refused unless the age on that day is 18–100. A later day past 100 reports `age` in `missing` and has no suggestion.

## Alternatives considered

| Shape | Why it lost |
| --- | --- |
| Client-side calculator with nothing stored | The profile is typed again on every visit, and formulas leak into every client. |
| Profile columns on `user_targets` | It mixes inputs with outputs, and every targets save would have to carry sex and birth year. |
| Effective-dated `user_profiles` | Nothing reads a past profile, so the history is a cost with no reader. |
| A separate suggestion route | The client would have to save the profile and then read the suggestion, two calls for one action. |

## Open questions and risks

- Should the MCP server expose the profile view, so an assistant can explain the suggested targets?
- Should the suggestion also cover steps and exercise minutes from the activity level?
- ~~Should "lose" and "gain" take a rate (for example 0.5 kg a week) instead of a fixed percentage?~~ Answered below.

## Next implementation step

Add `user_profiles` and `src/profile/contract.ts`. Then implement `suggestTargets` against unit tests, and the view against an integration test.

## Weekly rate (follow-up)

The goal direction became a signed rate, `weeklyChangeKg`, from -1 to 0.5 in steps of 0.25. Zero is maintain. A rate replaces the direction rather than sitting beside it. Two fields would allow "maintain at 0.5 kg a week", and every caller would have to know the rate is ignored then. The sign still picks protein per kilogram. Gains stop at half a kilogram because past that most of the extra is fat.

```http
PUT /v1/profile/2026-10-17
{ "sex": "female", "birthYear": 1992, "activity": "moderate", "weeklyChangeKg": -0.5 }
→ 200 { …, "suggestion": { "basis": { …, "maintenanceKcal": 2170, "expectedWeeklyChangeKg": -0.5 },
                           "targets": { "kcal": 1620, … } } }
```

Energy moves by `weeklyChangeKg × 7,700 / 7` kcal a day, rounded to 10, from the rounded maintenance. A cut still never goes below resting energy, so `basis.expectedWeeklyChangeKg` reports the rate the suggested energy actually gives. It can be slower than the one asked for, and the dialog says so. The column stores grams (`weekly_change_g`), like the goal weight. Migration 0012 maps saved goals to roughly the change they had: lose to -0.5 kg (a fifth off maintenance) and gain to +0.25 kg (a tenth on).
