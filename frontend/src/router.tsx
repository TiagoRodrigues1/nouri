import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Dashboard, FoodRoute, OverviewRoute, TodayRoute } from "./views";

const rootRoute = createRootRoute({ component: Dashboard });

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: TodayRoute,
});

const foodRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/food",
  component: FoodRoute,
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/overview",
  component: OverviewRoute,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([todayRoute, overviewRoute, foodRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
