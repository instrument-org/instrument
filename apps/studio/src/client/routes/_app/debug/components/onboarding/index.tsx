import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/debug/components/onboarding/")({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({ to: "/debug/components/onboarding/login" });
  },
});
