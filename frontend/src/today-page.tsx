import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { styles } from "./dashboard-styles";
import { getDay, type FoodEntry } from "./lib/api";
import { useIdempotentDelete } from "./lib/use-idempotent";
import { useWater } from "./lib/use-water";
import { MyDay } from "./my-day";

export function TodayPage({ token, date, isToday, foodDelete, water, customizingCards, onCustomizingCardsChange }: { token: string; date: string; isToday: boolean; foodDelete: ReturnType<typeof useIdempotentDelete<FoodEntry>>; water: ReturnType<typeof useWater>; customizingCards: boolean; onCustomizingCardsChange: (open: boolean) => void }) {
  const dayQuery = useQuery({ queryKey: ["day", token, date], queryFn: () => getDay(token, date), enabled: Boolean(token) });
  const entries = dayQuery.data?.food.entries ?? [];

  const status = dayQuery.isPending && token ? (
    "Loading your food log…"
  ) : dayQuery.isError ? (
    <span>
      {dayQuery.error.message}{" "}
      <button {...stylex.props(styles.emptyButton)} onClick={() => void dayQuery.refetch()}>Try again</button>
    </span>
  ) : !token ? (
    "Connect your log to see your foods."
  ) : entries.length === 0 ? (
    <strong {...stylex.props(styles.emptyTitle)}>No foods logged yet</strong>
  ) : null;

  return <MyDay token={token} day={dayQuery.data} date={date} isToday={isToday} status={status} deletePending={foodDelete.isPending} onDelete={(entry) => foodDelete.mutate(entry)} water={water} customizingCards={customizingCards} onCustomizingCardsChange={onCustomizingCardsChange} />;
}
