import { z } from "zod";

export const cardIds = ["totals", "water", "supplements", "mix", "activity", "fasting", "largest", "meals"] as const;

export const cardIdSchema = z.enum(cardIds);

export const defaultCards: CardId[] = ["totals", "water", "supplements", "mix", "activity"];

// The list is the full layout: its order is the display order and a missing card is hidden.
export const dashboardSchema = z.object({
  cards: z.array(cardIdSchema).max(cardIds.length).refine((cards) => new Set(cards).size === cards.length, "Cards must be unique"),
}).strict();

export type CardId = z.infer<typeof cardIdSchema>;

export type Dashboard = z.infer<typeof dashboardSchema>;
