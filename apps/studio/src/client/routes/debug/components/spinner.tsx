import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/spinner")({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({
      search: { tab: "spinner" },
      to: "/debug/components/controls",
    });
  },
});
