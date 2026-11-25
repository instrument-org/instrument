import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/spinner")({
  beforeLoad: () => {
    throw redirect({
      search: { tab: "spinner" },
      to: "/debug/components/controls",
    });
  },
});
