import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/alerts")({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({
      search: { tab: "alerts" },
      to: "/debug/components/notices",
    });
  },
});
