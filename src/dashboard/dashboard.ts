import { eq } from "drizzle-orm";
import { dashboardLayouts } from "../db/schema.js";
import type { AppDatabase } from "../db/database.js";
import { cardIdSchema, defaultCards } from "./contract.js";
import type { CardId, Dashboard } from "./contract.js";

export async function getDashboard(db: AppDatabase, userId: string): Promise<Dashboard> {
  const [row] = await db.select({ cards: dashboardLayouts.cards }).from(dashboardLayouts).where(eq(dashboardLayouts.userId, userId));

  // Drop cards a later release retired instead of failing the whole layout.
  return { cards: row ? row.cards.filter((card): card is CardId => cardIdSchema.safeParse(card).success) : defaultCards };
}

export async function saveDashboard(db: AppDatabase, userId: string, dashboard: Dashboard): Promise<Dashboard> {
  await db.insert(dashboardLayouts).values({ userId, cards: dashboard.cards })
    .onConflictDoUpdate({ target: dashboardLayouts.userId, set: { cards: dashboard.cards, updatedAt: new Date() } });

  return dashboard;
}
