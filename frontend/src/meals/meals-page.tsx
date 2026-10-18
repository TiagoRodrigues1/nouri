import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CookingPot, Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { TimePicker } from "../components/ui/time-picker";
import { format, type ListedMeal, type SavedMeal } from "../lib/api";
import { unitLabels } from "../lib/food-text";
import { dailyDays, everyDay } from "../lib/saved-meals";
import { totalNutrients } from "../../../src/food/contract";
import { currentTime, recentDayLabel, timeZone } from "../lib/time";
import { useMealDaily, useSavedMeals } from "../lib/use-saved-meals";
import { Bone, Loading } from "../loading";
import { queryFallback } from "../query-status";
import { styles } from "./meals-styles";

// The meals you eat often. Each can log itself on chosen days; any can be logged from + Log, Food, Meals.
export function MealsPage() {
  const query = useSavedMeals();
  const meals = query.data;

  return (
    <>
      <header {...stylex.props(styles.header, styles.pageTop)}>
        <h1 {...stylex.props(styles.headline)}>Meals</h1>
        {meals && meals.length > 0 && (
          <Button asChild>
            <Link to="/meals/new" search={{}}><Plus size={16} /> New meal</Link>
          </Button>
        )}
      </header>
      <p {...stylex.props(styles.intro)}>
        Build the meals you eat often, then log them in one step from + Log, Food, Meals. A daily meal is already on the log of each day it's set for.
      </p>
      {!meals || query.isError ? (
        queryFallback(query, <MealsSkeleton />, styles.hint)
      ) : meals.length === 0 ? (
        <div {...stylex.props(styles.empty)}>
          <CookingPot size={28} />
          <p {...stylex.props(styles.emptyTitle)}>No meals yet</p>
          <p {...stylex.props(styles.hint)}>Add the foods of a usual breakfast or lunch once, and log it with one tap from then on.</p>
          <Button asChild>
            <Link to="/meals/new" search={{}}><Plus size={16} /> Create a meal</Link>
          </Button>
        </div>
      ) : (
        <MealGrid meals={meals} />
      )}
    </>
  );
}

const cardGap = 14;

// Cards keep their own heights and pack into the shortest column, so a short card moves up under its neighbour.
function MealGrid({ meals }: { meals: ListedMeal[] }) {
  const list = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const { target, borderBoxSize } of entries) {
        const height = borderBoxSize[0]?.blockSize ?? target.getBoundingClientRect().height;

        // SAFETY: The observer watches only this list's direct children, which are rendered as HTML li elements.
        (target as HTMLElement).style.gridRowEnd = `span ${Math.ceil(height) + cardGap}`;
      }
    });

    for (const item of list.current?.children ?? []) observer.observe(item);

    return () => observer.disconnect();
  }, [meals]);

  return (
    <ul ref={list} {...stylex.props(styles.grid, styles.masonry)} aria-label="Meals">
      {meals.map((meal) => <li key={meal.id} {...stylex.props(styles.masonryItem)}><MealCard meal={meal} /></li>)}
    </ul>
  );
}

function MealCard({ meal }: { meal: ListedMeal }) {
  const { kcal, proteinG, carbsG, fatG } = totalNutrients(meal.items.map(({ food }) => food.nutrients));

  return (
    <Card {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.cardBody)}>
        <div {...stylex.props(styles.cardTop)}>
          <Link to="/meals/$mealId" params={{ mealId: meal.id }} {...stylex.props(styles.mealName)}>{meal.name}</Link>
          <p {...stylex.props(styles.energy)}>{format(kcal)}<span {...stylex.props(styles.energyUnit)}>kcal</span></p>
        </div>
        <div {...stylex.props(styles.macros)}>
          <span {...stylex.props(styles.macro)}><span {...stylex.props(styles.dot, styles.protein)} />P {format(proteinG, 1)} g</span>
          <span {...stylex.props(styles.macro)}><span {...stylex.props(styles.dot, styles.carbs)} />C {format(carbsG, 1)} g</span>
          <span {...stylex.props(styles.macro)}><span {...stylex.props(styles.dot, styles.fat)} />F {format(fatG, 1)} g</span>
        </div>
        <p {...stylex.props(styles.foods)}>
          {meal.items.map(({ food }) => `${food.name} ${format(food.quantity.amount)} ${unitLabels[food.quantity.unit]}`).join(" · ")}
        </p>
        {meal.lastLogged && <p {...stylex.props(styles.lastLogged)}>Last logged {recentDayLabel(meal.lastLogged)}</p>}
      </div>
      <div {...stylex.props(styles.cardFooter)}>
        <DailyToggle meal={meal} />
        <Button asChild variant="ghost" size="sm">
          <Link to="/meals/$mealId" params={{ mealId: meal.id }} aria-label={`Edit ${meal.name}`}>Edit</Link>
        </Button>
      </div>
    </Card>
  );
}

// Ticking it logs the meal on today and every later day at the time shown; the editor narrows it to some weekdays.
// A daily meal's new time saves when the picker closes, keeping its weekdays. Unticking keeps the days already
// filled.
function DailyToggle({ meal }: { meal: SavedMeal }) {
  const daily = useMealDaily();
  const [time, setTime] = useState(meal.daily?.time ?? "08:00");
  const id = `daily-${meal.id}`;
  const days = dailyDays(meal.daily?.weekdays ?? everyDay);

  function saveTime(next: string) {
    if (meal.daily && next !== meal.daily.time) daily.set(meal, { ...meal.daily, time: next, timeZone });
  }

  return (
    <div {...stylex.props(styles.daily)}>
      <Checkbox
        id={id}
        checked={meal.daily !== null}
        disabled={daily.isPending}
        aria-label={`Log ${meal.name} ${days.phrase}`}
        onCheckedChange={(checked) => daily.set(meal, checked === true ? { time, timeZone, weekdays: everyDay } : null)}
      />
      <label htmlFor={id} {...stylex.props(styles.dailyLabel, meal.daily && styles.dailyOn)}>{days.label} at</label>
      <TimePicker
        id={`${id}-time`}
        value={time}
        onChange={setTime}
        onClose={() => saveTime(time)}
        onNow={() => {
          const now = currentTime();

          setTime(now);
          saveTime(now);
        }}
      />
    </div>
  );
}

// Three meal cards: name and energy, macros, foods, and the daily row.
function MealsSkeleton() {
  return (
    <Loading label="Loading your meals…">
      <div {...stylex.props(styles.grid)}>
        {[0, 1, 2].map((index) => (
          <Card key={index} {...stylex.props(styles.card)}>
            <div {...stylex.props(styles.cardBody)}>
              <div {...stylex.props(styles.cardTop)}>
                <Bone width="45%" height={16} />
                <Bone width={64} height={22} />
              </div>
              <Bone width="60%" height={11} />
              <Bone width="80%" height={11} />
            </div>
            <div {...stylex.props(styles.cardFooter)}>
              <Bone width={150} height={22} />
              <Bone width={40} height={22} />
            </div>
          </Card>
        ))}
      </div>
    </Loading>
  );
}
