import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { OnboardingThemeScreen } from "@/client/components/onboarding/theme-screen";
import { createFileRoute } from "@tanstack/react-router";

import { OnboardingWindowFrame } from "../onboarding";

export const Route = createFileRoute("/_app/debug/components/onboarding/theme")(
  {
    component: RouteComponent,
  },
);

function RouteComponent() {
  return (
    <OnboardingWindowFrame>
      <OnboardingLayout showBack>
        <OnboardingThemeScreen />
      </OnboardingLayout>
    </OnboardingWindowFrame>
  );
}
