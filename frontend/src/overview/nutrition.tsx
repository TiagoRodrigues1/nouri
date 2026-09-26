import * as stylex from "@stylexjs/stylex";
import { Apple, Droplet, Flame, PieChart, Plus, Utensils } from "lucide-react";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import { reference, waterGoalMl, waterPresets } from "../lib/goals";
import { format, type Overview as OverviewData } from "../lib/api";
import { styles } from "../overview-styles";
import { colors } from "../theme.stylex";
import { Caption, Section, Tile, Value, clock } from "./shared";

export function NutritionSection({ nutrition, onLogFood, waterPending, onAddWater }: { nutrition: OverviewData["nutrition"]; onLogFood: () => void; waterPending: boolean; onAddWater: (volumeMl: number) => void }) {
  const { totals, entries } = nutrition.food;
  const waterMl = nutrition.water.totalMl ?? 0;
  const times = entries.map((entry) => new Date(entry.occurredAt));
  const first = times[0];
  const last = times.at(-1);

  const macros = [
    { label: "Protein", value: totals.proteinG, target: reference.proteinG, color: colors.protein },
    { label: "Carbs", value: totals.carbsG, target: reference.carbsG, color: colors.carbs },
    { label: "Fat", value: totals.fatG, target: reference.fatG, color: colors.fat },
  ];

  return (
    <Section
      title="Nutrition"
      description="Energy, macros, and water from your food log."
      icon={<Apple size={18} />}
      color={colors.food}
      action={<Button variant="outline" size="sm" onClick={onLogFood}><Plus size={15} /> Log food</Button>}
    >
      <Tile title="Energy" icon={<Flame size={16} />} aside={`${format(reference.kcal)} kcal reference`}>
        <Value value={format(totals.kcal)} unit="kcal" />
        <Progress value={totals.kcal ?? 0} max={reference.kcal} color={colors.food} aria-label="Energy against the reference value" />
        <Caption>
          {totals.kcal != null
            ? `${Math.round((totals.kcal / reference.kcal) * 100)}% of the reference`
            : entries.length ? "Some foods have no energy value" : "No foods logged"}
        </Caption>
      </Tile>
      <Tile title="Macros" icon={<PieChart size={16} />} aside="grams">
        <div {...stylex.props(styles.rows)}>
          {macros.map((macro) => (
            <div key={macro.label} {...stylex.props(styles.macro)}>
              <div {...stylex.props(styles.row)}>
                <span {...stylex.props(styles.rowLabel)}>{macro.label}</span>
                <span {...stylex.props(styles.rowValue)}>{format(macro.value, 1)} / {format(macro.target)} g</span>
              </div>
              <Progress value={macro.value ?? 0} max={macro.target} color={macro.color} aria-label={`${macro.label} against the reference value`} />
            </div>
          ))}
        </div>
      </Tile>
      <Tile title="Water" icon={<Droplet size={16} />} aside={`${format(waterGoalMl)} ml goal`}>
        <Value value={format(waterMl)} unit="ml" />
        <Progress value={waterMl} max={waterGoalMl} color={colors.water} aria-label="Water against the daily goal" />
        <div {...stylex.props(styles.actions)}>
          {waterPresets.map(({ volumeMl }) => (
            <Button key={volumeMl} variant="outline" size="sm" disabled={waterPending} aria-label={`Add ${volumeMl} ml of water`} onClick={() => onAddWater(volumeMl)}>
              +{volumeMl} ml
            </Button>
          ))}
        </div>
      </Tile>
      <Tile title="Foods" icon={<Utensils size={16} />}>
        <Value value={String(entries.length)} unit={entries.length === 1 ? "food logged" : "foods logged"} />
        <Caption>{first && last ? `Between ${clock.format(first)} and ${clock.format(last)}` : "Nothing logged yet"}</Caption>
      </Tile>
    </Section>
  );
}

