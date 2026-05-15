import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { ProviderSetupScreen } from "@/client/components/onboarding/provider-setup-screen";
import { createFileRoute } from "@tanstack/react-router";
import { noop } from "radashi";

import { OnboardingWindowFrame } from "../onboarding";

export const Route = createFileRoute("/_app/debug/components/onboarding/login")(
  {
    component: RouteComponent,
  },
);

const noopAsync = () => Promise.resolve();

function RouteComponent() {
  return (
    <div className="flex flex-wrap gap-8">
      <OnboardingWindowFrame>
        <OnboardingLayout>
          <ProviderSetupScreen
            onContinue={noop}
            onLogin={noopAsync}
            onLoginSuccess={noop}
          />
        </OnboardingLayout>
      </OnboardingWindowFrame>

      <OnboardingWindowFrame>
        <OnboardingLayout>
          <ProviderSetupScreen
            error={new Error("Login failed")}
            onContinue={noop}
            onLogin={noopAsync}
            onLoginSuccess={noop}
          />
        </OnboardingLayout>
      </OnboardingWindowFrame>
    </div>
  );
}
