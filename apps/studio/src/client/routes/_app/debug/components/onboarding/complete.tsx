import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { OnboardingWelcomeScreen } from "@/client/components/onboarding/welcome-screen";
import { createFileRoute } from "@tanstack/react-router";

import { OnboardingWindowFrame } from "../onboarding";

export const Route = createFileRoute(
  "/_app/debug/components/onboarding/complete",
)({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <OnboardingWindowFrame>
      <OnboardingLayout showBack={false}>
        <OnboardingWelcomeScreen
          isSetupComplete
          onLogin={() => Promise.resolve()}
        />
      </OnboardingLayout>
    </OnboardingWindowFrame>
  );
}
