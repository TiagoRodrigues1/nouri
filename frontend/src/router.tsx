import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { Dashboard } from "./views";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Dashboard view="today" />,
});

const foodRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/food",
  component: () => <Dashboard view="food" />,
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/overview",
  component: () => <Dashboard view="overview" />,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([todayRoute, overviewRoute, foodRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
