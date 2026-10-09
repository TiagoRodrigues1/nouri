import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Beef, ChartColumn, Flame, LayoutDashboard } from "lucide-react";
import { calorieTolerance, isCompleteFood } from "../../src/review/contract";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { useDashboardPage } from "./dashboard-page-context";
import { format, getReview, type Review as ReviewData, type ReviewDay } from "./lib/api";
import { shortDayLabel } from "./lib/time";
import { duration } from "./overview/shared";
import { queryFallback } from "./query-status";
import { Bone, Loading } from "./loading";
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

type Nutrient = "kcal" | "proteinG";

const units: Record<Nutrient, string> = { kcal: "kcal", proteinG: "g" };

// A day whose foods lack a value says so rather than showing a partial sum.
// A complete day also shows how far it landed from that day's target.
function foodTotal(day: ReviewDay, nutrient: Nutrient) {
  const value = day.food[nutrient];
  const unit = units[nutrient];

  if (day.food.entryCount === 0) return <Blank />;

  if (value === null) return <span {...stylex.props(styles.muted)} title="A logged food has no value for this">Incomplete</span>;

  const target = day.targets[nutrient];
  const difference = Math.round(value - target);

  return (
    <>
      <Amount value={format(value)} unit={unit} />
      {isCompleteFood(day.food) && (
        <span {...stylex.props(styles.difference)} title={`Target ${format(target)} ${unit}`}>
          {difference === 0 ? "on target" : `${difference > 0 ? "+" : "−"}${format(Math.abs(difference))}`}
        </span>
      )}
    </>
  );
}

const metrics: Metric[] = [
  { label: "Calories", cell: (day) => foodTotal(day, "kcal"), recorded: (counts) => counts.food },
  { label: "Protein", cell: (day) => foodTotal(day, "proteinG"), recorded: (counts) => counts.food },
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

type ComparisonProps = {
  title: string;
  icon: ReactNode;
  nutrient: Nutrient;
  rule: string;
  nutrition: ReviewData["nutrition"];
};

function Comparison({ title, icon, nutrient, rule, nutrition }: ComparisonProps) {
  const { average, averageTarget, daysOnTarget } = nutrition[nutrient];
  const unit = units[nutrient];
  const days = nutrition.completeDays;

  return (
    <Card>
      <CardHeader {...stylex.props(styles.comparisonHeader)}>
        <CardTitle {...stylex.props(styles.comparisonTitle)}>{icon} {title}</CardTitle>
      </CardHeader>
      <CardContent {...stylex.props(styles.comparisonContent)}>
        {average === null || averageTarget === null ? (
          <p {...stylex.props(styles.muted)}>No complete food days to compare yet.</p>
        ) : (
          <>
            <p {...stylex.props(styles.comparisonValue)}>
              <Amount value={format(average)} unit={`${unit} a day`} />
            </p>
            <p {...stylex.props(styles.muted)}>
              Target {format(averageTarget)} {unit}. {rule} on <strong>{daysOnTarget} of {days}</strong> complete {days === 1 ? "day" : "days"}.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function Review() {
  const { date } = useDashboardPage();

  const query = useQuery({
    queryKey: ["review", date],
    queryFn: () => getReview(date),
  });

  const review = query.data;

  if (!review || query.isError) return queryFallback(query, <ReviewSkeleton />, styles.status);
  const total = review.days.length;

  return (
    <div {...stylex.props(styles.page)}>
      <p {...stylex.props(styles.summary)}>
        Records on <strong>{review.recordedDays.any} of {total} days</strong>. Complete food records on <strong>{review.nutrition.completeDays} of {total} days</strong>:
        food logged and every food has calories and protein. Only those days are compared with your targets.
      </p>
      <div {...stylex.props(styles.comparisons)}>
        <Comparison title="Calories" icon={<Flame size={15} />} nutrient="kcal" rule={`Within ${calorieTolerance * 100}% of target`} nutrition={review.nutrition} />
        <Comparison title="Protein" icon={<Beef size={15} />} nutrient="proteinG" rule="Reached target" nutrition={review.nutrition} />
      </div>
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

// The summary, the two comparisons, and the seven-day table, as placeholders.
function ReviewSkeleton() {
  return (
    <Loading label="Loading your week…">
      <div {...stylex.props(styles.page)}>
        <Bone width="62%" height={13} />
        <div {...stylex.props(styles.comparisons)}>
          {[0, 1].map((index) => (
            <Card key={index}>
              <CardHeader {...stylex.props(styles.comparisonHeader)}><Bone width={90} height={13} /></CardHeader>
              <CardContent {...stylex.props(styles.comparisonContent)}>
                <Bone width={120} height={24} />
                <Bone width="55%" height={11} />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card {...stylex.props(styles.card)}>
          <Table>
            <TableBody>
              {Array.from({ length: 8 }, (_, row) => (
                <TableRow key={row}>
                  <TableCell><Bone width={row === 0 ? 40 : 70} height={12} /></TableCell>
                  {metrics.map((metric) => <TableCell key={metric.label}><Bone width="70%" height={12} /></TableCell>)}
                  <TableCell><Bone width={52} height={12} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </Loading>
  );
}
