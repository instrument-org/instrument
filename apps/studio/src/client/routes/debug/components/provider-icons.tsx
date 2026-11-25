import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/provider-icons")({
  beforeLoad: () => {
    throw redirect({
      search: { tab: "providers" },
      to: "/debug/components/icons",
    });
  },
});
