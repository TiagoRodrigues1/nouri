import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { Dashboard } from "./views";

const rootRoute = createRootRoute({ component: Dashboard });

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./today-page"), "TodayPage"),
});

const foodRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/food",
  component: lazyRouteComponent(() => import("./food-page"), "FoodPage"),
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/overview",
  component: lazyRouteComponent(() => import("./overview"), "Overview"),
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([todayRoute, overviewRoute, foodRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
