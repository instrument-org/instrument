import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { OnboardingWelcomeScreen } from "@/client/components/onboarding/welcome-screen";
import { createFileRoute } from "@tanstack/react-router";

import { OnboardingWindowFrame } from "../onboarding";

export const Route = createFileRoute("/_app/debug/components/onboarding/login")(
  {
    component: RouteComponent,
  },
);

function RouteComponent() {
  return (
    <div className="flex flex-wrap gap-8">
      <OnboardingWindowFrame>
        <OnboardingLayout showBack={false}>
          <OnboardingWelcomeScreen
            isSetupComplete={false}
            onLogin={() => Promise.resolve()}
          />
        </OnboardingLayout>
      </OnboardingWindowFrame>

      <OnboardingWindowFrame>
        <OnboardingLayout showBack={false}>
          <OnboardingWelcomeScreen
            error={new Error("Login failed")}
            isSetupComplete={false}
            onLogin={() => Promise.resolve()}
          />
        </OnboardingLayout>
      </OnboardingWindowFrame>
    </div>
  );
}
