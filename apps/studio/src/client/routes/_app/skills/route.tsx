import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/skills")({
  // Skills are behind a feature flag, so the routes are reachable by URL (and
  // by a restored tab) even while the sidebar entry is hidden. Read the flag
  // here rather than from the atom so a direct navigation is decided before
  // anything renders. A failed read leaves the routes open: the flag is a
  // rollout gate, not a security boundary.
  beforeLoad: async () => {
    const [error, features] = await safe(rpcClient.features.getAll.call());
    if (!error && !features.skills) {
      // oxlint-disable-next-line typescript/only-throw-error
      throw redirect({ to: "/new-tab" });
    }
  },
  component: Outlet,
});
