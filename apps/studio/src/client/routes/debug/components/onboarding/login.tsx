import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { ProviderSetupScreen } from "@/client/components/onboarding/provider-setup-screen";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { noop } from "radashi";

import { getOnboardingScreen } from "../../-debug-routes";
import { OnboardingWindowFrame } from "../onboarding";

export const Route = createFileRoute("/debug/components/onboarding/login")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getOnboardingScreen("login").label }],
  }),
});

function RouteComponent() {
  const navigate = useNavigate();
  // Onboarding sends the manual provider link to its own screen, so this one
  // does too.
  const addProvider = () =>
    void navigate({ to: getOnboardingScreen("providers").to });
  return (
    <div className="flex flex-wrap gap-8">
      <OnboardingWindowFrame>
        <OnboardingLayout variant="brand">
          <ProviderSetupScreen
            onAddProvider={addProvider}
            onContinue={noop}
            onLoginSuccess={noop}
            onPageChange={noop}
            page="welcome"
          />
        </OnboardingLayout>
      </OnboardingWindowFrame>

    </div>
  );
}
