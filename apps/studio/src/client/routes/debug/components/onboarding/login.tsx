import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { type SignInOutcome } from "@/shared/sign-in-outcome";
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

// Never settles, so a press shows the button waiting on the browser until
// it is canceled.
const waitForever = () => new Promise<SignInOutcome>(noop);

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
            onLogin={waitForever}
            onLoginSuccess={noop}
            onPageChange={noop}
            page="welcome"
          />
        </OnboardingLayout>
      </OnboardingWindowFrame>

      <OnboardingWindowFrame>
        <OnboardingLayout variant="brand">
          <ProviderSetupScreen
            error={new Error("Login failed")}
            onAddProvider={addProvider}
            onContinue={noop}
            onLogin={waitForever}
            onLoginSuccess={noop}
            onPageChange={noop}
            page="welcome"
          />
        </OnboardingLayout>
      </OnboardingWindowFrame>
    </div>
  );
}
