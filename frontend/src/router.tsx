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

export const router = createRouter({
  routeTree: rootRoute.addChildren([todayRoute, foodRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
