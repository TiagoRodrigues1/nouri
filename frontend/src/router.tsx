import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { Dashboard } from "./views";

const rootRoute = createRootRoute({ component: Dashboard });

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./today-page"), "TodayPage"),
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
