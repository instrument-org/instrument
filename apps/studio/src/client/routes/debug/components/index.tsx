import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/")({
  beforeLoad: () => {
    throw redirect({ to: "/debug" });
  },
});
