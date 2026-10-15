import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import { reviewRangeSchema } from "../../src/review/contract";
import { DayLayout, Dashboard } from "./views";

const rootRoute = createRootRoute({ component: Dashboard });

// The pages that show a day or a week, under its date header. Meals sit beside them, outside it.
const dayLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "day",
  component: DayLayout,
});

const daySearch = z.object({ date: z.iso.date().optional().catch(undefined) });

const todayRoute = createRoute({
  getParentRoute: () => dayLayoutRoute,
  path: "/",
  validateSearch: daySearch,
  component: lazyRouteComponent(() => import("./my-day"), "MyDay"),
});

// The food journal now lives on Today, so old links land there.
const foodRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/food",
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});

const overviewRoute = createRoute({
  getParentRoute: () => dayLayoutRoute,
  path: "/overview",
  validateSearch: daySearch,
  component: lazyRouteComponent(() => import("./overview"), "Overview"),
});

const progressRoute = createRoute({
  getParentRoute: () => dayLayoutRoute,
  path: "/progress",
  // The exercise is its key; without one the page shows the most recent exercise.
  validateSearch: daySearch.extend({ exercise: z.string().max(80).optional().catch(undefined) }),
  component: lazyRouteComponent(() => import("./progress"), "Progress"),
});

const reviewRoute = createRoute({
  getParentRoute: () => dayLayoutRoute,
  path: "/review",
  // The last day under review and how many days end on it. Without them the review covers the week ending today.
  validateSearch: z.object({ to: z.iso.date().optional().catch(undefined), days: reviewRangeSchema.optional().catch(undefined) }),
  component: lazyRouteComponent(() => import("./review"), "Review"),
});

const mealsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/meals",
  component: lazyRouteComponent(() => import("./meals/meals-page"), "MealsPage"),
});

// A new meal; with a date it starts from that day's foods, as the Timeline's Save as meal does.
const newMealRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/meals/new",
  validateSearch: daySearch,
  component: lazyRouteComponent(() => import("./meals/meal-editor"), "NewMealPage"),
});

const mealRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/meals/$mealId",
  component: lazyRouteComponent(() => import("./meals/meal-editor"), "EditMealPage"),
});

const workoutsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workouts",
  component: lazyRouteComponent(() => import("./workouts/routines-page"), "RoutinesPage"),
});

const newRoutineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workouts/routines/new",
  component: lazyRouteComponent(() => import("./workouts/routine-editor"), "NewRoutinePage"),
});

const routineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workouts/routines/$routineId",
  component: lazyRouteComponent(() => import("./workouts/routine-editor"), "EditRoutinePage"),
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workouts/session",
  component: lazyRouteComponent(() => import("./workouts/session-page"), "SessionPage"),
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([dayLayoutRoute.addChildren([todayRoute, overviewRoute, progressRoute, reviewRoute]), mealsRoute, newMealRoute, mealRoute, workoutsRoute, newRoutineRoute, routineRoute, sessionRoute, foodRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
