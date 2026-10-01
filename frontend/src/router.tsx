import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import { Dashboard } from "./views";

const rootRoute = createRootRoute({ component: Dashboard });

const daySearch = z.object({ date: z.iso.date().optional().catch(undefined) });

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: daySearch,
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
  validateSearch: daySearch,
  component: lazyRouteComponent(() => import("./overview"), "Overview"),
});

const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  // The last day of the week under review. Without it the week ends today.
  validateSearch: z.object({ to: z.iso.date().optional().catch(undefined) }),
  component: lazyRouteComponent(() => import("./review"), "Review"),
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([todayRoute, overviewRoute, reviewRoute, foodRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
