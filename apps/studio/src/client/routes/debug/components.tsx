import { createFileRoute, Outlet } from "@tanstack/react-router";

import { getDebugRoute } from "./-debug-routes";

export const Route = createFileRoute("/debug/components")({
  component: Outlet,
  head: () => ({
    meta: [{ title: getDebugRoute("components").title }],
  }),
});
