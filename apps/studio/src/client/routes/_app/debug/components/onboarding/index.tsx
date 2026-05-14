import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/debug/components/onboarding/")({
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: "/debug/components/onboarding/login" });
  },
});
