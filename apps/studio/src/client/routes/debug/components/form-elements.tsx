import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/form-elements")({
  beforeLoad: () => {
    throw redirect({
      search: { tab: "form-elements" },
      to: "/debug/components/controls",
    });
  },
});
