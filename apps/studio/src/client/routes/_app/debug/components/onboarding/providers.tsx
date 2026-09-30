import { AddProviderForm } from "@/client/components/add-provider/form";
import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { createFileRoute } from "@tanstack/react-router";
import { noop } from "radashi";

import { getOnboardingScreen } from "../../-debug-routes";
import { OnboardingWindowFrame } from "../onboarding";

export const Route = createFileRoute(
  "/_app/debug/components/onboarding/providers",
)({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getOnboardingScreen("providers").label }],
  }),
});

function RouteComponent() {
  return (
    <OnboardingWindowFrame>
      <OnboardingLayout>
        <div className="flex-1 overflow-y-auto px-11 pt-6 pb-11">
          <AddProviderForm onSuccess={noop} providers={[]} submitLabel="Next" />
        </div>
      </OnboardingLayout>
    </OnboardingWindowFrame>
  );
}
