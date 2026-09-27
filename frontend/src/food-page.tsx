import * as stylex from "@stylexjs/stylex";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame, ListOrdered, Pencil, Plus, RotateCcw, Trash2, Utensils, UtensilsCrossed } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Progress } from "./components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { styles } from "./food-page-styles";
import { colors } from "./theme.stylex";
import { format, type Day, type FoodEntry } from "./lib/api";
import { dayQueryOptions } from "./lib/day-query";
import { kcalPerGram } from "./lib/nutrition";
import { entryHour, entryTime } from "./lib/time";
import { useLogAgain } from "./lib/use-log-again";
import { useTargets, type TargetsState } from "./lib/use-targets";
import { queryStatus } from "./query-status";
import { useDashboardPage } from "./dashboard-page-context";
import { TargetsNotice } from "./targets-notice";

// Grouped by the hour eaten rather than by a meal label the log does not record.
const periods = [
  { name: "MORNING", until: 11 },
  { name: "MIDDAY", until: 15 },
  { name: "AFTERNOON", until: 18 },
  { name: "EVENING", until: 24 },
] as const;

type Totals = Day["food"]["totals"];

export function FoodPage() {
  const { token, date, isToday, onLogFood, onEditFood, foodDelete } = useDashboardPage();
  const dayQuery = useQuery(dayQueryOptions(token, date));
  const targets = useTargets(token, date);
  const logAgain = useLogAgain(token, date);
  const entries = dayQuery.data?.food.entries ?? [];
  const status = queryStatus(token, dayQuery, { disconnected: "Connect your log to see your foods.", loading: "Loading your food log…" });

  if (status || !dayQuery.data) return <p {...stylex.props(styles.empty)}>{status}</p>;

  return (
    <div {...stylex.props(styles.grid)}>
      <div {...stylex.props(styles.column)}>
        <IntakeCard totals={dayQuery.data.food.totals} entries={entries} targets={targets} isToday={isToday} />
        <MealsCard
          entries={entries}
          isToday={isToday}
          busy={foodDelete.isPending || logAgain.pending}
          onLogFood={onLogFood}
          onLogAgain={logAgain.logAgain}
          onEdit={onEditFood}
          onDelete={(entry) => foodDelete.mutate(entry)}
        />
      </div>
      <div {...stylex.props(styles.column)}>
        <TopFoodsCard entries={entries} totals={dayQuery.data.food.totals} />
      </div>
    </div>
  );
}

function Panel({ title, icon, aside, children }: { title: string; icon: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader {...stylex.props(styles.header)}>
        <CardTitle {...stylex.props(styles.title)}>{icon} {title}</CardTitle>
        {aside && <span {...stylex.props(styles.aside)}>{aside}</span>}
      </CardHeader>
      <CardContent {...stylex.props(styles.content)}>{children}</CardContent>
    </Card>
  );
}

// Without targets the card still shows what was eaten; only the comparisons wait.
function IntakeCard({ totals, entries, targets: state, isToday }: { totals: Totals; entries: FoodEntry[]; targets: TargetsState; isToday: boolean }) {
  const { targets } = state;
  const kcal = totals.kcal;
  const left = kcal === null || !targets ? null : targets.kcal - kcal;
  const macroKcal = (["proteinG", "carbsG", "fatG"] as const).reduce((sum, key) => sum + (totals[key] ?? 0) * kcalPerGram[key], 0);
  const missing = entries.filter(({ food }) => Object.values(food.nutrients).some((value) => value === null)).length;

  const macros = [
    { key: "proteinG", label: "Protein", color: colors.protein },
    { key: "carbsG", label: "Carbs", color: colors.carbs },
    { key: "fatG", label: "Fat", color: colors.fat },
  ] as const;

  return (
    <Panel title={isToday ? "Intake so far" : "Intake"} icon={<Flame size={16} />} aside={targets && `${format(targets.kcal)} kcal target`}>
      <div {...stylex.props(styles.energy)}>
        <div {...stylex.props(styles.energyLine)}>
          <div>
            <span {...stylex.props(styles.big)}>{format(kcal)}</span>
            <span {...stylex.props(styles.unit)}>kcal</span>
          </div>
          {left !== null && entries.length > 0 && (
            <span {...stylex.props(styles.remaining, left < 0 && styles.over)}>
              {left >= 0 ? `${format(left)} kcal left` : `${format(-left)} kcal over`}
            </span>
          )}
        </div>
        {targets && <Progress value={kcal ?? 0} max={targets.kcal} color={colors.food} aria-label="Energy against your target" />}
      </div>
      <div {...stylex.props(styles.macros)}>
        {macros.map(({ key, label, color }) => {
          const grams = totals[key];

          return (
            <div key={key} {...stylex.props(styles.macro)}>
              <div {...stylex.props(styles.macroHead)}>
                <span {...stylex.props(styles.macroName)}><span {...stylex.props(styles.swatch(color))} />{label}</span>
                <span {...stylex.props(styles.macroValue)}>{format(grams)}{targets && ` / ${format(targets[key])}`} g</span>
              </div>
              {targets && <Progress value={grams ?? 0} max={targets[key]} color={color} aria-label={`${label} against your target`} />}
              <span {...stylex.props(styles.macroShare)}>
                {grams !== null && macroKcal > 0 ? `${Math.round(((grams * kcalPerGram[key]) / macroKcal) * 100)}% of energy` : " "}
              </span>
            </div>
          );
        })}
      </div>
      <TargetsNotice state={state} style={styles.note} />
      {missing > 0 && (
        <p {...stylex.props(styles.note)}>
          {missing} {missing === 1 ? "food is" : "foods are"} missing some nutrient values, so the affected totals are incomplete.
        </p>
      )}
    </Panel>
  );
}

function MealsCard({ entries, isToday, busy, onLogFood, onLogAgain, onEdit, onDelete }: { entries: FoodEntry[]; isToday: boolean; busy: boolean; onLogFood: () => void; onLogAgain: (entry: FoodEntry) => void; onEdit: (entry: FoodEntry) => void; onDelete: (entry: FoodEntry) => void }) {

  const groups = periods.flatMap((period, index) => {
    const eaten = entries.filter((entry) => {
      const hour = entryHour(entry);

      return hour < period.until && hour >= (periods[index - 1]?.until ?? 0);
    });

    return eaten.length > 0 ? [{ name: period.name, entries: eaten }] : [];
  });

  // Logging again always lands today, so a past day says so rather than implying it adds to this one.
  const logAgainWhen = isToday ? "now" : "today";

  return (
    <Panel
      title="Meals"
      icon={<Utensils size={16} />}
      aside={<Button variant="outline" size="sm" onClick={onLogFood}><Plus size={15} /> Add food</Button>}
    >
      {groups.length === 0 ? (
        <div {...stylex.props(styles.empty)}>
          <UtensilsCrossed size={20} />
          <strong {...stylex.props(styles.emptyTitle)}>No foods logged</strong>
          <span>Search the catalog or enter a food yourself.</span>
        </div>
      ) : (
        <div {...stylex.props(styles.meals)}>
          {groups.map((group) => (
            <section key={group.name} {...stylex.props(styles.meal)} aria-label={group.name.toLowerCase()}>
              <div {...stylex.props(styles.mealHead)}>
                <span {...stylex.props(styles.mealName)}>{group.name}</span>
                <span {...stylex.props(styles.mealTotal)}>{format(sum(group.entries, "kcal"))} kcal</span>
              </div>
              <ul {...stylex.props(styles.list)}>
                {group.entries.map((entry) => {
                  const { name, quantity, nutrients } = entry.food;

                  return (
                    <li key={entry.id} {...stylex.props(styles.entry)}>
                      <div {...stylex.props(styles.entryText)}>
                        <strong {...stylex.props(styles.entryName)}>{name}</strong>
                        <span {...stylex.props(styles.entryMeta)}>
                          {entryTime(entry)} · {format(quantity.amount, 1)} {quantity.unit} · P {format(nutrients.proteinG, 1)} · C {format(nutrients.carbsG, 1)} · F {format(nutrients.fatG, 1)}
                        </span>
                      </div>
                      <span {...stylex.props(styles.entryKcal)}>{format(nutrients.kcal)} kcal</span>
                      <Button variant="ghost" size="icon" {...stylex.props(styles.entryAction)} aria-label={`Log ${name} again ${logAgainWhen}`} title={`Log again ${logAgainWhen}`} disabled={busy} onClick={() => onLogAgain(entry)}>
                        <RotateCcw size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" {...stylex.props(styles.entryAction)} aria-label={`Edit ${name}`} title="Edit" disabled={busy} onClick={() => onEdit(entry)}>
                        <Pencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" {...stylex.props(styles.entryAction)} aria-label={`Delete ${name}`} disabled={busy} onClick={() => onDelete(entry)}>
                        <Trash2 size={15} />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}

const rankings = {
  kcal: { label: "Energy", unit: "kcal", digits: 0, color: colors.food },
  proteinG: { label: "Protein", unit: "g", digits: 1, color: colors.protein },
} as const;

type Ranking = keyof typeof rankings;

const rankingKeys: Ranking[] = ["kcal", "proteinG"];

type Food = FoodEntry["food"];

// Catalog foods are the same food when they share a catalog record, whatever they were named.
// A manual food has no record, so it matches another only with the same name (ignoring case and spacing)
// and the same nutrients per unit it was measured in. Two different "Yogurt" entries stay apart,
// while the same yogurt logged in different amounts counts as one.
function foodIdentity({ name, quantity, nutrients, catalogRef }: Food): string {
  if (catalogRef) return JSON.stringify(["catalog", catalogRef.provider, catalogRef.id]);

  const basis = quantity.unit === "serving" ? ["serving", quantity.servingSize.amount, quantity.servingSize.unit] : [quantity.unit];
  const perUnit = Object.values(nutrients).map((value) => (value === null ? null : Math.round((value / quantity.amount) * 1e6) / 1e6));

  return JSON.stringify(["manual", name.trim().replace(/\s+/g, " ").toLowerCase(), ...basis, ...perUnit]);
}

function TopFoodsCard({ entries, totals }: { entries: FoodEntry[]; totals: Totals }) {
  const [by, setBy] = useState<Ranking>("kcal");
  const { unit, digits, color } = rankings[by];
  const total = totals[by];

  // The same food eaten twice counts once, so the ranking shows what really drove the day.
  const byFood = new Map<string, { name: string; value: number }>();

  for (const { food } of entries) {
    const value = food.nutrients[by];

    if (value === null) continue;
    const key = foodIdentity(food);
    const ranked = byFood.get(key);

    if (ranked) ranked.value += value;
    else byFood.set(key, { name: food.name, value });
  }

  const top = [...byFood].filter(([, { value }]) => value > 0).sort((a, b) => b[1].value - a[1].value).slice(0, 5);

  return (
    <Panel title="Top foods" icon={<ListOrdered size={16} />}>
      <Tabs value={by} onValueChange={(next) => setBy(next === "proteinG" ? "proteinG" : "kcal")}>
        <TabsList aria-label="Rank foods by">
          {rankingKeys.map((key) => <TabsTrigger key={key} value={key}>{rankings[key].label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {top.length === 0 ? (
        <p {...stylex.props(styles.empty)}>Log foods to see which ones drive your {rankings[by].label.toLowerCase()}.</p>
      ) : (
        <ol {...stylex.props(styles.ranking)} aria-label={`Top foods by ${rankings[by].label.toLowerCase()}`}>
          {top.map(([key, { name, value }]) => (
            <li key={key} {...stylex.props(styles.rank)}>
              <div {...stylex.props(styles.rankHead)}>
                <span {...stylex.props(styles.rankName)}>{name}</span>
                <span {...stylex.props(styles.rankValue)}>
                  {format(value, digits)} {unit}{total ? ` · ${Math.round((value / total) * 100)}%` : ""}
                </span>
              </div>
              <Progress value={value} max={total || value} color={color} aria-label={`${name} share of the day`} />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function sum(entries: FoodEntry[], key: keyof FoodEntry["food"]["nutrients"]): number | null {
  return entries.some(({ food }) => food.nutrients[key] === null) ? null : entries.reduce((total, { food }) => total + (food.nutrients[key] ?? 0), 0);
}
