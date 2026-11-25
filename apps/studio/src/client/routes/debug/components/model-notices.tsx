import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/model-notices")({
  beforeLoad: () => {
    throw redirect({
      search: { tab: "model-notices" },
      to: "/debug/components/notices",
    });
  },
});
