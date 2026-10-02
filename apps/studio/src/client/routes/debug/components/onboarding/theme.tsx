import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { OnboardingThemeScreen } from "@/client/components/onboarding/theme-screen";
import { createFileRoute } from "@tanstack/react-router";

import { getOnboardingScreen } from "../../-debug-routes";
import { OnboardingWindowFrame } from "../onboarding";

export const Route = createFileRoute("/debug/components/onboarding/theme")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getOnboardingScreen("theme").label }],
  }),
});

function RouteComponent() {
  return (
    <OnboardingWindowFrame>
      <OnboardingLayout>
        <OnboardingThemeScreen />
      </OnboardingLayout>
    </OnboardingWindowFrame>
  );
}
