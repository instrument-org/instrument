import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/error-card")({
  beforeLoad: () => {
    throw redirect({
      search: { tab: "error-card" },
      to: "/debug/components/notices",
    });
  },
});
