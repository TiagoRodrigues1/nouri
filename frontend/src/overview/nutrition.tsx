import * as stylex from "@stylexjs/stylex";
import { Apple, Droplet, Flame, PieChart, Utensils } from "lucide-react";
import { Progress } from "../components/ui/progress";
import { format, type Overview as OverviewData, type Targets } from "../lib/api";
import { clock } from "../lib/time";
import { styles } from "../overview-styles";
import { colors } from "../theme.stylex";
import { Caption, Section, Tile, Value } from "./shared";

export function NutritionSection({ nutrition, targets }: { nutrition: OverviewData["nutrition"]; targets: Targets | undefined }) {
  const { totals, entries } = nutrition.food;
  const waterMl = nutrition.water.totalMl ?? 0;
  const times = entries.map((entry) => new Date(entry.occurredAt));
  const first = times[0];
  const last = times.at(-1);

  const macros = [
    { label: "Protein", value: totals.proteinG, target: targets?.proteinG, color: colors.protein },
    { label: "Carbs", value: totals.carbsG, target: targets?.carbsG, color: colors.carbs },
    { label: "Fat", value: totals.fatG, target: targets?.fatG, color: colors.fat },
  ];

  return (
    <Section
      title="Nutrition"
      description="Energy, macros, and water from your food log."
      icon={<Apple size={18} />}
      color={colors.food}
    >
      <Tile title="Energy" icon={<Flame size={16} />} aside={targets && `${format(targets.kcal)} kcal target`}>
        <Value value={format(totals.kcal)} unit="kcal" />
        {targets && <Progress value={totals.kcal ?? 0} max={targets.kcal} color={colors.food} aria-label="Energy against your target" />}
        {totals.kcal == null ? (
          <Caption>{entries.length ? "Some foods have no energy value" : "No foods logged"}</Caption>
        ) : targets && (
          <Caption>{`${Math.round((totals.kcal / targets.kcal) * 100)}% of your target`}</Caption>
        )}
      </Tile>
      <Tile title="Macros" icon={<PieChart size={16} />} aside="grams">
        <div {...stylex.props(styles.rows)}>
          {macros.map((macro) => (
            <div key={macro.label} {...stylex.props(styles.macro)}>
              <div {...stylex.props(styles.row)}>
                <span {...stylex.props(styles.rowLabel)}>{macro.label}</span>
                <span {...stylex.props(styles.rowValue)}>{format(macro.value, 1)}{macro.target !== undefined && ` / ${format(macro.target)}`} g</span>
              </div>
              {macro.target !== undefined && <Progress value={macro.value ?? 0} max={macro.target} color={macro.color} aria-label={`${macro.label} against your target`} />}
            </div>
          ))}
        </div>
      </Tile>
      <Tile title="Water" icon={<Droplet size={16} />} aside={targets && `${format(targets.waterMl)} ml goal`}>
        <Value value={format(waterMl)} unit="ml" />
        {targets && <Progress value={waterMl} max={targets.waterMl} color={colors.water} aria-label="Water against the daily goal" />}
      </Tile>
      <Tile title="Foods" icon={<Utensils size={16} />}>
        <Value value={String(entries.length)} unit={entries.length === 1 ? "food logged" : "foods logged"} />
        <Caption>{first && last ? `Between ${clock.format(first)} and ${clock.format(last)}` : "Nothing logged yet"}</Caption>
      </Tile>
    </Section>
  );
}

