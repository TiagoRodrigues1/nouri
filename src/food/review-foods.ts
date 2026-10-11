import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { approveFood, pendingFoods, rejectFood, type Approval } from "./community.js";

// Reviews foods people added before everyone can find them. Nouri has no admin role, so the operator runs this:
//   pnpm foods:review               lists foods waiting for review
//   pnpm foods:review approve <id>  shares one with everyone
//   pnpm foods:review reject <id>   deletes one, pending or reviewed; entries already logged from it stay
const url = process.env.DATABASE_URL;

if (!url) throw new Error("DATABASE_URL is required");

const client = postgres(url, { max: 1 });

const db = drizzle(client);

const [command, argument] = process.argv.slice(2);

// Not a UUID can't be any food, and Postgres would refuse to compare it.
const target = z.uuid().safeParse(argument).data;

const format = (value: number | null) => value === null ? "?" : String(value);

const approvalMessages: Record<Approval, string> = {
  approved: "Approved.",
  missing: "No pending food has this id.",
  conflict: "Another reviewed food already has this barcode. Reject one of them first.",
};

try {
  if (command === undefined) {
    const foods = await pendingFoods(db);

    if (foods.length === 0) console.log("No foods are waiting for review.");

    for (const { id, food, brand, barcode, serving, addedAt } of foods) {
      const { kcal, proteinG, carbsG, fatG } = food.nutrients;
      const unit = food.quantity.unit;

      console.log(`${id}  ${food.name}${brand ? ` (${brand})` : ""}${barcode ? `  barcode ${barcode}` : ""}`);
      console.log(`  per 100 ${unit}: ${format(kcal)} kcal, protein ${format(proteinG)} g, carbs ${format(carbsG)} g, fat ${format(fatG)} g${serving ? `; serving ${serving.amount} ${unit}` : ""}`);
      console.log(`  added ${addedAt.toISOString()}`);
    }
  } else if (command === "approve" && argument) {
    console.log(target ? approvalMessages[await approveFood(db, target)] : approvalMessages.missing);
  } else if (command === "reject" && argument) {
    console.log(target && await rejectFood(db, target) ? "Rejected and deleted." : "No food has this id.");
  } else {
    console.error("Usage: pnpm foods:review [approve <id> | reject <id>]");
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
