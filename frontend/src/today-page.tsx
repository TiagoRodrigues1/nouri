import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { styles } from "./dashboard-styles";
import { dayQueryOptions } from "./lib/day-query";
import { MyDay } from "./my-day";
import { useDashboardPage } from "./dashboard-page-context";
import { queryStatus } from "./query-status";

export function TodayPage() {
  const { date } = useDashboardPage();
  const dayQuery = useQuery(dayQueryOptions(date));
  const entries = dayQuery.data?.food.entries ?? [];

  const status = queryStatus(dayQuery, "Loading your food log…")
    ?? (entries.length === 0 ? <strong {...stylex.props(styles.emptyTitle)}>No foods logged yet</strong> : null);

  return <MyDay day={dayQuery.data} status={status} />;
}
