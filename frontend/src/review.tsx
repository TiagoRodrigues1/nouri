import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { Beef, ChartColumn, Droplet, Flame, LayoutDashboard, Lightbulb, Moon, Scale, TrendingUp } from "lucide-react";
import { calorieTolerance, defaultReviewDays, isCompleteFood } from "../../src/review/contract";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { useDashboardPage } from "./dashboard-page-context";
import { format, getReview, type Review as ReviewData, type ReviewDay, type ReviewPeriod } from "./lib/api";
import { shortDayLabel } from "./lib/time";
import { duration } from "./overview/shared";
import { ProgressChart } from "./progress-chart";
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
  { label: "Water", cell: ({ water }) => water.totalMl === null ? <Blank /> : <Amount value={format(water.totalMl)} unit="ml" />, recorded: (counts) => counts.water },
  {
    label: "Supplements",
    // Taken out of that day's list; intakes of supplements since removed still count as taken.
    cell: ({ supplements }) => {
      if (supplements.intakeCount === 0) return <Blank />;

      if (supplements.stackSize === 0) return <Amount value={format(supplements.intakeCount)} unit="taken" />;

      return <Amount value={`${supplements.taken} of ${supplements.stackSize}`} unit="taken" />;
    },
    recorded: (counts) => counts.supplements,
  },
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
  comparison: ReviewPeriod["water"];
  show: (value: number) => string;
  rule: string;
  // How many days were compared, and what one and several of them are called.
  measured: number;
  noun: [one: string, many: string];
  empty: string;
};

function Comparison({ title, icon, comparison, show, rule, measured, noun, empty }: ComparisonProps) {
  const { average, averageTarget, daysOnTarget } = comparison;

  return (
    <Card>
      <CardHeader {...stylex.props(styles.comparisonHeader)}>
        <CardTitle {...stylex.props(styles.comparisonTitle)}>{icon} {title}</CardTitle>
      </CardHeader>
      <CardContent {...stylex.props(styles.comparisonContent)}>
        {average === null || averageTarget === null ? (
          <p {...stylex.props(styles.muted)}>{empty}</p>
        ) : (
          <>
            <p {...stylex.props(styles.comparisonValue)}>{show(average)}</p>
            <p {...stylex.props(styles.muted)}>
              Target {show(averageTarget)}. {rule} on <strong>{daysOnTarget} of {measured}</strong> {measured === 1 ? noun[0] : noun[1]}.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const kcal = (value: number) => `${format(value)} kcal`;

const grams = (value: number) => `${format(value)} g`;

const millilitres = (value: number) => `${format(value)} ml`;

const minutes = (value: number) => duration(Math.round(value));

// Food is compared over complete days only; water and sleep over the days that have them.
function Comparisons({ review }: { review: ReviewData }) {
  const { nutrition, recordedDays } = review;
  const food: Pick<ComparisonProps, "measured" | "noun" | "empty"> = { measured: nutrition.completeDays, noun: ["complete day", "complete days"], empty: "No complete food days to compare yet." };

  return (
    <div {...stylex.props(styles.comparisons)}>
      <Comparison title="Calories" icon={<Flame size={15} />} comparison={nutrition.kcal} show={kcal} rule={`Within ${calorieTolerance * 100}% of target`} {...food} />
      <Comparison title="Protein" icon={<Beef size={15} />} comparison={nutrition.proteinG} show={grams} rule="Reached target" {...food} />
      <Comparison
        title="Water" icon={<Droplet size={15} />} comparison={review.water} show={millilitres} rule="Reached target"
        measured={recordedDays.water} noun={["day", "days"]} empty="No water logged in these days."
      />
      <Comparison
        title="Sleep" icon={<Moon size={15} />} comparison={review.sleep} show={minutes} rule="Reached target"
        measured={recordedDays.sleep} noun={["night", "nights"]} empty="No sleep recorded in these days."
      />
    </div>
  );
}

// Drawn from the last week of the range, each with what it rests on.
function Suggestions({ review }: { review: ReviewData }) {
  const week = review.weeks.at(-1);

  if (!week || review.suggestions.length === 0) return null;

  return (
    <Card {...stylex.props(styles.trendCard)}>
      <CardHeader {...stylex.props(styles.trendHeader)}>
        <CardTitle {...stylex.props(styles.comparisonTitle)}><Lightbulb size={15} /> Suggestions</CardTitle>
        <p {...stylex.props(styles.muted)}>From {shortDayLabel(week.from)} to {shortDayLabel(week.to)}</p>
      </CardHeader>
      <CardContent {...stylex.props(styles.trendContent)}>
        <ul {...stylex.props(styles.suggestions)}>
          {review.suggestions.map((suggestion) => (
            <li key={suggestion.kind} {...stylex.props(styles.suggestion)}>
              <strong>{suggestion.title}</strong>
              <span {...stylex.props(styles.muted)}>{suggestion.because}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

type WeekMetric = {
  label: string;
  value: (week: ReviewPeriod) => number | null;
  show: (value: number) => string;
  // The decimal places `show` keeps, so a change is taken between the values as shown.
  digits: number;
};

const weekMetrics: WeekMetric[] = [
  { label: "Calories", value: (week) => week.nutrition.kcal.average, show: kcal, digits: 0 },
  { label: "Protein", value: (week) => week.nutrition.proteinG.average, show: grams, digits: 0 },
  { label: "Water", value: (week) => week.water.average, show: millilitres, digits: 0 },
  { label: "Sleep", value: (week) => week.sleep.average, show: minutes, digits: 0 },
  // A week's total; a week without workouts stays blank, as a day does.
  { label: "Workouts", value: (week) => week.workouts.count === 0 ? null : week.workouts.totalMinutes, show: minutes, digits: 0 },
  { label: "Weight", value: (week) => week.weightKg, show: (value) => `${format(value, 1)} kg`, digits: 1 },
];

// Two weeks that read the same show no change, never "+0 g".
function change(value: number, before: number, { show, digits }: WeekMetric): string {
  const scale = 10 ** digits;
  const difference = (Math.round(value * scale) - Math.round(before * scale)) / scale;

  return difference === 0 ? "no change" : `${difference > 0 ? "+" : "−"}${show(Math.abs(difference))}`;
}

// One row per whole week with its averages, and each one's change from the week before.
function WeeklyTrends({ review }: { review: ReviewData }) {
  return (
    <Card {...stylex.props(styles.trendCard)}>
      <CardHeader {...stylex.props(styles.trendHeader)}>
        <CardTitle {...stylex.props(styles.comparisonTitle)}><TrendingUp size={15} /> Weekly trends</CardTitle>
        <p {...stylex.props(styles.muted)}>Daily averages, with workouts totalled</p>
      </CardHeader>
      <CardContent {...stylex.props(styles.trendContent)}>
        {review.weeks.length < 2 ? (
          <p {...stylex.props(styles.muted)}>Choose 2 weeks or longer to compare weeks.</p>
        ) : (
          <Table aria-label="Weekly trends">
            <TableHeader>
              <TableRow>
                <TableHead {...stylex.props(styles.dayColumn)}>Week</TableHead>
                {weekMetrics.map((metric) => <TableHead key={metric.label} {...stylex.props(styles.number)}>{metric.label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {review.weeks.map((week, index) => {
                const previous = review.weeks[index - 1];

                return (
                  <TableRow key={week.from}>
                    <TableHead scope="row" {...stylex.props(styles.dayColumn)}>{shortDayLabel(week.from)} – {shortDayLabel(week.to)}</TableHead>
                    {weekMetrics.map((metric) => {
                      const value = metric.value(week);
                      const before = previous ? metric.value(previous) : null;

                      return (
                        <TableCell key={metric.label} {...stylex.props(styles.number)}>
                          {value === null ? <Blank /> : metric.show(value)}
                          {value !== null && before !== null && (
                            <span {...stylex.props(styles.difference)} title="Change from the week before">{change(value, before, metric)}</span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// The days with a weight, as a line across the whole range, with the change from the first to the last.
function WeightTrend({ review }: { review: ReviewData }) {
  const points = review.days.flatMap(({ date, weightKg }) => weightKg === null ? [] : [{ date, value: weightKg, label: shortDayLabel(date) }]);
  const first = points[0];
  const last = points.at(-1);
  const change = first && last && points.length > 1 ? Math.round((last.value - first.value) * 10) / 10 : null;

  return (
    <Card {...stylex.props(styles.trendCard)}>
      <CardHeader {...stylex.props(styles.trendHeader)}>
        <CardTitle {...stylex.props(styles.comparisonTitle)}><Scale size={15} /> Weight</CardTitle>
        {change !== null && first && (
          <p {...stylex.props(styles.muted)}>
            <strong {...stylex.props(styles.trendChange)}>{change === 0 ? "No change" : `${change > 0 ? "+" : "−"}${format(Math.abs(change), 1)} kg`}</strong> since {shortDayLabel(first.date)}
          </p>
        )}
      </CardHeader>
      <CardContent {...stylex.props(styles.trendContent)}>
        {points.length === 0
          ? <p {...stylex.props(styles.muted)}>No weight logged in these days.</p>
          : <ProgressChart points={points} label="Weight in kilograms" unit="kg" noun="weigh-ins" span={{ from: review.from, to: review.to }} />}
      </CardContent>
    </Card>
  );
}

export function Review() {
  const { date } = useDashboardPage();
  const days = useSearch({ from: "/day/review", select: (search) => search.days ?? defaultReviewDays });

  const query = useQuery({
    queryKey: ["review", date, days],
    queryFn: () => getReview(date, days),
  });

  const review = query.data;

  if (!review || query.isError) return queryFallback(query, <ReviewSkeleton rows={days} />, styles.status);
  const total = review.days.length;

  return (
    <div {...stylex.props(styles.page)}>
      <p {...stylex.props(styles.summary)}>
        Records on <strong>{review.recordedDays.any} of {total} days</strong>. Complete food records on <strong>{review.nutrition.completeDays} of {total} days</strong>:
        food logged and every food has calories and protein. Only those days are compared with your targets.
        {review.supplements.stackDays > 0 && <> Every supplement on your list taken on <strong>{review.supplements.fullDays} of {review.supplements.stackDays} days</strong>.</>}
      </p>
      <Suggestions review={review} />
      <Comparisons review={review} />
      <WeightTrend review={review} />
      <WeeklyTrends review={review} />
      <Card {...stylex.props(styles.card)}>
        <Table aria-label={`${total}-day review`}>
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

// The summary, the four comparisons, the weight chart, and the table, as placeholders.
function ReviewSkeleton({ rows }: { rows: number }) {
  return (
    <Loading label="Loading your review…">
      <div {...stylex.props(styles.page)}>
        <Bone width="62%" height={13} />
        <div {...stylex.props(styles.comparisons)}>
          {[0, 1, 2, 3].map((index) => (
            <Card key={index}>
              <CardHeader {...stylex.props(styles.comparisonHeader)}><Bone width={90} height={13} /></CardHeader>
              <CardContent {...stylex.props(styles.comparisonContent)}>
                <Bone width={120} height={24} />
                <Bone width="55%" height={11} />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card {...stylex.props(styles.trendCard)}>
          <CardHeader {...stylex.props(styles.trendHeader)}><Bone width={80} height={13} /></CardHeader>
          <CardContent {...stylex.props(styles.trendContent)}><Bone width="100%" height={220} /></CardContent>
        </Card>
        <Card {...stylex.props(styles.card)}>
          <Table>
            <TableBody>
              {Array.from({ length: rows + 1 }, (_, row) => (
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
