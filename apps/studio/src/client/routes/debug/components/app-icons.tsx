import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/app-icons")({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({ search: { tab: "apps" }, to: "/debug/components/icons" });
  },
});
