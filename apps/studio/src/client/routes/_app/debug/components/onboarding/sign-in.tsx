import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { OnboardingWelcomeScreen } from "@/client/components/onboarding/welcome-screen";
import { createFileRoute } from "@tanstack/react-router";

import { OnboardingWindowFrame } from "../onboarding";

export const Route = createFileRoute(
  "/_app/debug/components/onboarding/sign-in",
)({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex flex-wrap gap-8">
      <OnboardingWindowFrame>
        <OnboardingLayout showBack={false}>
          <OnboardingWelcomeScreen isSetupComplete={false} />
        </OnboardingLayout>
      </OnboardingWindowFrame>

      <OnboardingWindowFrame>
        <OnboardingLayout showBack={false}>
          <OnboardingWelcomeScreen
            error={new Error("Sign in failed")}
            isSetupComplete={false}
          />
        </OnboardingLayout>
      </OnboardingWindowFrame>
    </div>
  );
}
