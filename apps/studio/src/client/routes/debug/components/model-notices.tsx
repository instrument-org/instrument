import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/model-notices")({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({
      search: { tab: "model-notices" },
      to: "/debug/components/notices",
    });
  },
});
