import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { ProviderSetupFlow } from "@/client/components/onboarding/provider-setup-flow";
import { createFileRoute } from "@tanstack/react-router";
import { noop } from "radashi";

import { OnboardingWindowFrame } from "../onboarding";

export const Route = createFileRoute(
  "/_app/debug/components/onboarding/complete",
)({
  component: RouteComponent,
});

const noopAsync = () => Promise.resolve();

function RouteComponent() {
  return (
    <OnboardingWindowFrame>
      <OnboardingLayout>
        <ProviderSetupFlow
          onContinue={noop}
          onLogin={noopAsync}
          onLoginSuccess={noop}
        />
      </OnboardingLayout>
    </OnboardingWindowFrame>
  );
}
