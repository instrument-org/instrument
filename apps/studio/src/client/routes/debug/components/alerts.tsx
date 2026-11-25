import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/alerts")({
  beforeLoad: () => {
    throw redirect({
      search: { tab: "alerts" },
      to: "/debug/components/notices",
    });
  },
});
