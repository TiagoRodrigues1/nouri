import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus, Search, Trash2, UtensilsCrossed } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { styles } from "./dashboard-styles";
import { dateLabel, format, getDay, timeZone as zone, type FoodEntry } from "./lib/api";
import { useIdempotentDelete } from "./lib/use-idempotent";

export function FoodPage({ token, date, isToday, onLogFood, foodDelete }: { token: string; date: string; isToday: boolean; onLogFood: () => void; foodDelete: ReturnType<typeof useIdempotentDelete<FoodEntry>> }) {
  const dayQuery = useQuery({ queryKey: ["day", token, date], queryFn: () => getDay(token, date), enabled: Boolean(token) });

  const day = dayQuery.data;
  const entries = day?.food.entries ?? [];
  const totals = day?.food.totals;

  return (
    <div {...stylex.props(styles.dashboardGrid)}>
      <div {...stylex.props(styles.column)}>
        <Card>
          <CardHeader sx={styles.cardHeader}>
            <CardTitle sx={styles.cardTitle}>
              {isToday ? "Today so far" : "Daily summary"}
            </CardTitle>
            <span {...stylex.props(styles.cardOverline)}>
              {day?.food.entryCount ?? 0}{" "}
              {day?.food.entryCount === 1 ? "food" : "foods"} logged
            </span>
          </CardHeader>
          <CardContent sx={styles.overviewContent}>
            <div {...stylex.props(styles.metricGrid)}>
              <Metric
                value={token ? String(day?.food.entryCount ?? 0) : "—"}
                label="foods"
              />
              <Metric
                value={token ? format(totals?.kcal) : "—"}
                label="kcal"
              />
              <Metric
                value={token ? format(totals?.proteinG, 1) : "—"}
                label="protein, g"
              />
              <Metric
                value={token ? format(totals?.carbsG, 1) : "—"}
                label="carbs, g"
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader sx={styles.cardHeader}>
            <div>
              <CardTitle sx={styles.cardTitle}>Food</CardTitle>
              <p {...stylex.props(styles.foodCardDate)}>{isToday ? "Today's entries" : dateLabel(date)}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              sx={styles.foodCardButton}
              onClick={onLogFood}
            >
              <Plus size={15} /> Add food
            </Button>
          </CardHeader>
          <CardContent sx={styles.foodCardContent}>
            <div {...stylex.props(styles.energyRow)}>
              <div>
                <span {...stylex.props(styles.energyValue)}>
                  {token ? format(totals?.kcal) : "—"}
                </span>
                <span {...stylex.props(styles.energyUnit)}>kcal logged</span>
              </div>
              <div {...stylex.props(styles.macroInline)}>
                P {token ? format(totals?.proteinG, 1) : "—"}g&nbsp; C{" "}
                {token ? format(totals?.carbsG, 1) : "—"}g&nbsp; F{" "}
                {token ? format(totals?.fatG, 1) : "—"}g
              </div>
            </div>
            {dayQuery.isPending && token ? (
              <p {...stylex.props(styles.emptyState)}>Loading your food log…</p>
            ) : dayQuery.isError ? (
              <p {...stylex.props(styles.emptyState)}>
                {dayQuery.error.message}{" "}
                <button {...stylex.props(styles.emptyButton)} onClick={() => void dayQuery.refetch()}>
                  Try again
                </button>
              </p>
            ) : !token ? (
              <p {...stylex.props(styles.emptyState)}>Connect to see your foods.</p>
            ) : entries.length === 0 ? (
              <div {...stylex.props(styles.emptyState)}>
                <UtensilsCrossed size={22} {...stylex.props(styles.iconAccent)} />
                <strong {...stylex.props(styles.emptyTitle)}>No foods logged yet</strong>
                <span>Start with a food search or add your own.</span>
                <Button
                  variant="outline"
                  size="sm"
                  sx={styles.emptyButton}
                  onClick={onLogFood}
                >
                  Log a food
                </Button>
              </div>
            ) : (
              <ul {...stylex.props(styles.entryList)} aria-label="Logged foods">
                {entries.map((entry) => (
                  <li key={entry.id} {...stylex.props(styles.entry)}>
                    <span {...stylex.props(styles.entryMark)}>
                      <UtensilsCrossed size={17} />
                    </span>
                    <div {...stylex.props(styles.entryDetail)}>
                      <strong {...stylex.props(styles.entryDetailText, styles.entryName)}>{entry.food.name}</strong>
                      <small {...stylex.props(styles.entryDetailText, styles.entryMeta)}>
                        {format(entry.food.quantity.amount, 2)}{" "}
                        {entry.food.quantity.unit} ·{" "}
                        {new Intl.DateTimeFormat("en", {
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: zone,
                        }).format(new Date(entry.occurredAt))}
                      </small>
                    </div>
                    <span {...stylex.props(styles.entryCalories)}>
                      {format(entry.food.nutrients.kcal)} kcal
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      sx={styles.entryDeleteButton}
                      aria-label={`Delete ${entry.food.name}`}
                      disabled={foodDelete.isPending}
                      onClick={() => foodDelete.mutate(entry)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p {...stylex.props(styles.cardFootnote)}>
              Values reflect what you've logged for this day.
            </p>
          </CardContent>
        </Card>
      </div>
      <div {...stylex.props(styles.column)}>
        <Card sx={styles.tipCard}>
          <CardContent sx={styles.tipContent}>
            <div {...stylex.props(styles.tipIcon)}>
              <Search size={22} />
            </div>
            <p {...stylex.props(styles.tipEyebrow)}>QUICK START</p>
            <h2 {...stylex.props(styles.tipHeading)}>What's on your plate?</h2>
            <p {...stylex.props(styles.tipText)}>
              Find a food in the Ciqual catalog or enter your own
              nutrition details.
            </p>
            <Button variant="outline" sx={styles.tipButton} onClick={onLogFood}>
              Add your first food <ChevronRight size={17} />
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader sx={styles.cardHeader}>
            <CardTitle sx={styles.cardTitle}>Daily nutrition</CardTitle>
          </CardHeader>
          <CardContent sx={styles.detailContent}>
            <NutritionLine
              label="Protein"
              value={token ? format(totals?.proteinG, 1) : "—"}
            />
            <NutritionLine
              label="Carbs"
              value={token ? format(totals?.carbsG, 1) : "—"}
            />
            <NutritionLine
              label="Fat"
              value={token ? format(totals?.fatG, 1) : "—"}
            />
            <p {...stylex.props(styles.detailFootnote)}>Totals are calculated from your logged foods.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div><strong {...stylex.props(styles.metricValue)}>{value}</strong><span {...stylex.props(styles.metricLabel)}>{label}</span></div>;
}

function NutritionLine({ label, value }: { label: string; value: string }) {
  return <div {...stylex.props(styles.nutritionLine)}><span {...stylex.props(styles.nutritionLabel)}>{label}</span><strong {...stylex.props(styles.nutritionValue)}>{value} g</strong></div>;
}
