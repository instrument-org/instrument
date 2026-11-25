import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/toasts")({
  beforeLoad: () => {
    throw redirect({
      search: { tab: "toasts" },
      to: "/debug/components/notices",
    });
  },
});
