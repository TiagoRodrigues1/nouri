import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { ChartColumn, LayoutDashboard } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { useDashboardPage } from "./dashboard-page-context";
import { format, getReview, type Review as ReviewData, type ReviewDay } from "./lib/api";
import { localDate, shortDayLabel } from "./lib/time";
import { duration } from "./overview/shared";
import { queryStatus } from "./query-status";
import { styles } from "./review-styles";

type Metric = {
  label: string;
  cell: (day: ReviewDay) => ReactNode;
  recorded: (counts: ReviewData["recordedDays"]) => number;
};

function Amount({ value, unit }: { value: string; unit: string }) {
  return (
    <>
      {value}
      <span {...stylex.props(styles.unit)}>{unit}</span>
    </>
  );
}

// A day with no record of a kind stays blank, never zero.
function Blank() {
  return <span {...stylex.props(styles.hidden)}>Not logged</span>;
}

// A day whose foods lack a value says so rather than showing a partial sum.
function foodTotal(day: ReviewDay, value: number | null, unit: string) {
  if (day.food.entryCount === 0) return <Blank />;

  if (value === null) return <span {...stylex.props(styles.muted)} title="A logged food has no value for this">Incomplete</span>;

  return <Amount value={format(value)} unit={unit} />;
}

const metrics: Metric[] = [
  { label: "Calories", cell: (day) => foodTotal(day, day.food.kcal, "kcal"), recorded: (counts) => counts.food },
  { label: "Protein", cell: (day) => foodTotal(day, day.food.proteinG, "g"), recorded: (counts) => counts.food },
  {
    label: "Workouts",
    cell: ({ workouts }) => workouts.totalMinutes === null ? <Blank /> : (
      <>
        {duration(workouts.totalMinutes)}
        {workouts.entryCount > 1 && <span {...stylex.props(styles.unit)}>{workouts.entryCount} workouts</span>}
      </>
    ),
    recorded: (counts) => counts.workouts,
  },
  { label: "Sleep", cell: ({ sleep }) => sleep.totalMinutes === null ? <Blank /> : duration(sleep.totalMinutes), recorded: (counts) => counts.sleep },
  { label: "Weight", cell: ({ weightKg }) => weightKg === null ? <Blank /> : <Amount value={format(weightKg, 1)} unit="kg" />, recorded: (counts) => counts.weight },
];

export function Review() {
  const { token } = useDashboardPage();
  const date = useSearch({ from: "/review", select: (search) => search.to }) ?? localDate(new Date());

  const query = useQuery({
    queryKey: ["review", token, date],
    queryFn: () => getReview(token, date),
    enabled: Boolean(token),
  });

  const status = queryStatus(token, query, { disconnected: "Connect your log to review your week.", loading: "Loading your week…" });
  const review = query.data;

  if (status || !review) return <p {...stylex.props(styles.status)}>{status}</p>;
  const total = review.days.length;

  return (
    <div {...stylex.props(styles.page)}>
      <p {...stylex.props(styles.summary)}>
        Records on <strong>{review.recordedDays.any} of {total} days</strong>. Days without a record stay blank.
      </p>
      <Card {...stylex.props(styles.card)}>
        <Table aria-label="Seven-day review">
          <TableHeader>
            <TableRow>
              <TableHead {...stylex.props(styles.dayColumn)}>Day</TableHead>
              {metrics.map((metric) => <TableHead key={metric.label} {...stylex.props(styles.number)}>{metric.label}</TableHead>)}
              <TableHead {...stylex.props(styles.number)}>Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {review.days.map((day) => {
              const label = shortDayLabel(day.date);

              return (
                <TableRow key={day.date}>
                  <TableHead scope="row" {...stylex.props(styles.dayColumn)}>{label}</TableHead>
                  {metrics.map((metric) => <TableCell key={metric.label} {...stylex.props(styles.number)}>{metric.cell(day)}</TableCell>)}
                  <TableCell {...stylex.props(styles.number)}>
                    <span {...stylex.props(styles.links)}>
                      <Button asChild variant="ghost" size="icon-sm">
                        <Link to="/" search={{ date: day.date }} aria-label={`Open ${label} in Today`} title="Open in Today">
                          <LayoutDashboard size={15} />
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="icon-sm">
                        <Link to="/overview" search={{ date: day.date }} aria-label={`Open ${label} in Overview`} title="Open in Overview">
                          <ChartColumn size={15} />
                        </Link>
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableHead scope="row" {...stylex.props(styles.dayColumn)}>Days recorded</TableHead>
              {metrics.map((metric) => (
                <TableCell key={metric.label} {...stylex.props(styles.number, styles.muted)}>{metric.recorded(review.recordedDays)} of {total}</TableCell>
              ))}
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </Card>
    </div>
  );
}
