# Meals page

## Problem

A saved meal could only be made from foods already logged on a day, then edited inside the food dialog's Saved meals tab, and made daily from a checkbox in that tab. Creating "my usual breakfast" meant logging it first. Managing meals meant opening a dialog meant for logging. MyFitnessPal (Meals → Create a new meal), Cronometer (Foods → Custom meal, plus Repeat items), and MacroFactor (timeline selection opens the recipe builder) all keep meals in one place where they are built from search, and logging only picks one. Nouri now does the same.

## Usage (caller's view)

- **Meals** in the sidebar opens `/meals`: one card per meal with its foods, energy and macros, and a **Log every day at** toggle and time. **New meal** opens the editor.
- The editor (`/meals/new`, `/meals/<id>`) has the name, the foods with an amount each and a remove button, the meal's totals, an **Add food** panel with Recent, Search (including barcodes), and Manual tabs, the daily setting, **Save meal**, and **Delete meal**.
- The Timeline's **Save as meal** opens `/meals/new?date=<day>` with that day's foods already in the editor.
- **+ Log → Food → Meals** only logs: pick a meal, adjust amounts for this time, **Log meal**. **Manage meals** goes to the page.

```http
POST /v1/saved-meals                      Idempotency-Key
PATCH /v1/saved-meals/<id>                Idempotency-Key, If-Match
{"name":"Breakfast","daily":{"time":"08:00","timeZone":"Europe/Lisbon"},"items":[
  {"id":"<saved item>","amount":60},                                  // keep, re-amounted (edit only)
  {"entryId":"<logged entry>","amount":150},                          // copy a logged or recent food
  {"food":{"kind":"catalog","ref":{"provider":"ciqual","id":"13039","version":"2025"},"quantity":{"amount":120,"unit":"g"}}},   // Ciqual, as logging sends it
  {"food":{"name":"Skyr","quantity":{"amount":170,"unit":"g"},"nutrients":{…}}}   // typed or scanned label
]}
```

## Shape

```ts
// src/meals/contract.ts
mealItemInputSchema = { id, amount } | { entryId, amount } | { food: SubmittedFood }   // SubmittedFood is what logging sends
mealInputSchema = { name; items: MealItemInput[1..20]; daily: MealDaily | null }   // create and edit alike; daily is required

// src/food/food.ts
resolveFood(food: SubmittedFood): RecordedFood | null   // logging and meals measure a Ciqual food the same way

// src/meals/meals.ts
resolveItems(tx, userId, saved: StoredMealItem[], inputs): StoredMealItem[] | "missing" | "catalog-missing" | "invalid-item"
dailyColumns(daily, stored)   // shared by create and edit; the list's toggle is an edit

// frontend
lib/saved-meals.ts      MealRow (logging) and DraftRow = { key; source: saved | entry | submitted; food; amount: string }; draftItems(rows)
meals/meals-page.tsx    list + daily toggle
meals/meal-editor.tsx   editor page
meals/add-food-panel.tsx  Recent | Search | Manual pickers, each emitting a DraftRow
```

The server stays the only place a Ciqual food gets its nutrients. A new item's food is exactly what logging submits, checked by the same schema and resolved by the same `resolveFood`: a Ciqual food is a reference and an amount, and a manual or scanned one carries its nutrients, with a Ciqual reference on it refused. Create and edit share one body and one resolver; an edit is a full replacement in which `{id}` keeps a saved item (and its basis, so re-amounting never drifts) and anything else adds one. The daily setting is part of the body, so a new meal can be daily in one request; the cursor rule is unchanged.

The pickers in the food dialog take an action label and a callback, so the editor reuses Recent, Search, and Manual without logging anything.

## Synthesis decision

- **A: meals page with an editor page and source-tagged items** (above).
- **B: keep building meals from logged entries, with a better dialog.** Smallest change, but it keeps the problem the user named: a meal cannot exist before you eat it.
- **C: client-assembled meals of recorded foods.** The page would send every food's nutrients, including Ciqual ones, which the journal refuses as forgery, and catalog items would drift from the server's resolution.

A is the base. The editor is a page rather than a dialog because it hosts a food picker, which would otherwise be a dialog inside a dialog.

## Tradeoffs accepted

- PATCH replaces the meal whole, including `daily`, which is required so leaving it out cannot turn a daily meal off.
- The Save as meal dialog is gone; the editor replaces it.
- Items keep their insertion order; there is no reordering.
