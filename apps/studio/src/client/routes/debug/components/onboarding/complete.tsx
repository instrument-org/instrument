import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { OnboardingSuccessScreen } from "@/client/components/onboarding/success-screen";
import { createFileRoute } from "@tanstack/react-router";
import { noop } from "radashi";

import { getOnboardingScreen } from "../../-debug-routes";
import { OnboardingWindowFrame } from "../onboarding";

export const Route = createFileRoute("/debug/components/onboarding/complete")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getOnboardingScreen("complete").label }],
  }),
});

function RouteComponent() {
  return (
    <OnboardingWindowFrame>
      <OnboardingLayout variant="brand">
        <OnboardingSuccessScreen onContinue={noop} />
      </OnboardingLayout>
    </OnboardingWindowFrame>
  );
}
