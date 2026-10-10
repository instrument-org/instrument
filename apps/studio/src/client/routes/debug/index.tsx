import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/")({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({ to: "/debug/components" });
  },
});
