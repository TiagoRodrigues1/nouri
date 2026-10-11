import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { AppDatabase, Transaction } from "../db/database.js";
import { communityFoods } from "../db/schema.js";
import { requestHash, withReceipt } from "../journal/receipt.js";
import { searchKey } from "./catalog.js";
import { labelFoodSchema, type CommunityCandidate, type CommunityFoodInput, type LabelFood, type PackagedProduct } from "./contract.js";
import { milli, nutrientsOf, storedNutrients } from "./stored-nutrients.js";

type Row = typeof communityFoods.$inferSelect;

const searchLimit = 5;

// 100 g or ml of the food as the journal records it, with a reference to the food it came from.
function labelFood(row: Row): LabelFood {
  return {
    barcode: row.barcode,
    brand: row.brand,
    food: {
      name: row.name,
      quantity: { amount: 100, unit: row.unit },
      nutrients: nutrientsOf(row),
      catalogRef: { provider: "nouri", id: row.id },
    },
    serving: row.servingMilli === null ? null : { amount: row.servingMilli / 1000, unit: row.unit },
  };
}

// Everyone sees reviewed foods; the person who added a food sees it before review too.
function visibleTo(userId: string) {
  return or(isNotNull(communityFoods.reviewedAt), eq(communityFoods.userId, userId));
}

// A barcode belongs to at most one reviewed food.
async function reviewedBarcodeTaken(tx: Transaction, barcode: string): Promise<boolean> {
  const [taken] = await tx.select({ id: communityFoods.id }).from(communityFoods)
    .where(and(eq(communityFoods.barcode, barcode), isNotNull(communityFoods.reviewedAt)));

  return taken !== undefined;
}

// "duplicate" keeps no receipt, so the key can be sent again once the label changes.
export type CommunityFoodResult =
  | { outcome: "created"; entry: LabelFood }
  | { outcome: "key-reuse" }
  | { outcome: "duplicate"; message: string };

// Adds a label to Nouri's foods. Only its author sees it until it is reviewed. A barcode belongs to one reviewed
// food, and each person may add a barcode once.
export async function addCommunityFood(db: AppDatabase, userId: string, key: string, input: CommunityFoodInput): Promise<CommunityFoodResult> {
  return withReceipt(db, userId, key, requestHash({ kind: "community-food-create", input }), (receipt): CommunityFoodResult => {
    if (receipt.outcome !== "created") throw new Error("Community food receipt cannot be replayed");

    return { outcome: "created", entry: labelFoodSchema.parse(receipt.body) };
  }, async (tx): Promise<CommunityFoodResult> => {
    const { name, brand, barcode, unit, nutrientsPer100, serving } = input;

    if (barcode !== null && await reviewedBarcodeTaken(tx, barcode)) return { outcome: "duplicate", message: "A food with this barcode is already in Nouri" };

    // Two adds of one barcode racing each other meet on the person-and-barcode index.
    const [row] = await tx.insert(communityFoods).values({
      id: randomUUID(),
      userId,
      name,
      brand,
      barcode,
      unit,
      ...storedNutrients(nutrientsPer100),
      servingMilli: serving === null ? null : milli(serving.amount),
      searchText: searchKey(brand === null ? name : `${name} ${brand}`),
    }).onConflictDoNothing({ target: [communityFoods.userId, communityFoods.barcode] }).returning();

    return row ? { outcome: "created", entry: labelFood(row) } : { outcome: "duplicate", message: "You already added this barcode" };
  });
}

// LIKE treats % and _ as wildcards; a typed one means itself. The escape character is named in each pattern.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function matches(pattern: string) {
  return sql`${communityFoods.searchText} LIKE ${pattern} ESCAPE '\\'`;
}

// Community foods whose name or brand has every typed word, ignoring accents and case. Names starting with the
// first word come first, then shorter names.
export async function searchCommunityFoods(db: AppDatabase, userId: string, query: string): Promise<CommunityCandidate[]> {
  const words = searchKey(query).split(/[\s-]+/).filter(Boolean);
  const [first] = words;

  if (first === undefined) return [];

  const rows = await db.select().from(communityFoods)
    .where(and(visibleTo(userId), ...words.map((word) => matches(`%${escapeLike(word)}%`))))
    .orderBy(sql`${matches(`${escapeLike(first)}%`)} DESC`, sql`char_length(${communityFoods.name})`, asc(communityFoods.id))
    .limit(searchLimit);

  return rows.map((row) => ({ kind: "community", ...labelFood(row) }));
}

// The community food with this barcode: the reviewed one, else the person's own. Null when neither exists.
export async function communityProduct(db: AppDatabase, userId: string, barcode: string): Promise<PackagedProduct | null> {
  const [row] = await db.select().from(communityFoods)
    .where(and(eq(communityFoods.barcode, barcode), visibleTo(userId)))
    .orderBy(sql`${communityFoods.reviewedAt} IS NULL`)
    .limit(1);

  return row ? { ...labelFood(row), barcode } : null;
}

// Foods waiting for review, oldest first.
export async function pendingFoods(db: AppDatabase): Promise<Array<LabelFood & { id: string; addedAt: Date }>> {
  const rows = await db.select().from(communityFoods).where(isNull(communityFoods.reviewedAt)).orderBy(asc(communityFoods.createdAt));

  return rows.map((row) => ({ ...labelFood(row), id: row.id, addedAt: row.createdAt }));
}

// "conflict" when another reviewed food already has the barcode.
export type Approval = "approved" | "missing" | "conflict";

// Shares a pending food with everyone. Approvals of one barcode wait for each other, so a second never meets the
// reviewed-barcode index as an error.
export async function approveFood(db: AppDatabase, id: string): Promise<Approval> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(communityFoods).where(and(eq(communityFoods.id, id), isNull(communityFoods.reviewedAt))).for("update");

    if (!row) return "missing";

    if (row.barcode !== null) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`community-food-barcode:${row.barcode}`}))`);

      if (await reviewedBarcodeTaken(tx, row.barcode)) return "conflict";
    }

    await tx.update(communityFoods).set({ reviewedAt: new Date() }).where(eq(communityFoods.id, id));

    return "approved";
  });
}

// Removes a food, pending or reviewed, so the reviewer can withdraw a reviewed food to approve another with its
// barcode. Entries already logged from it keep their snapshot.
export async function rejectFood(db: AppDatabase, id: string): Promise<boolean> {
  const deleted = await db.delete(communityFoods).where(eq(communityFoods.id, id)).returning({ id: communityFoods.id });

  return deleted.length > 0;
}
