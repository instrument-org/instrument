import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { OnboardingSuccessScreen } from "@/client/components/onboarding/success-screen";
import { createFileRoute } from "@tanstack/react-router";
import { noop } from "radashi";

import { OnboardingWindowFrame } from "../onboarding";

export const Route = createFileRoute(
  "/_app/debug/components/onboarding/complete",
)({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <OnboardingWindowFrame>
      <OnboardingLayout>
        <OnboardingSuccessScreen onContinue={noop} />
      </OnboardingLayout>
    </OnboardingWindowFrame>
  );
}
