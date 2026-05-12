import { AddProviderForm } from "@/client/components/add-provider/form";
import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { createFileRoute } from "@tanstack/react-router";
import { noop } from "radashi";

import { OnboardingWindowFrame } from "../onboarding";

export const Route = createFileRoute(
  "/_app/debug/components/onboarding/providers",
)({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <OnboardingWindowFrame>
      <OnboardingLayout showBack>
        <div className="flex-1 overflow-y-auto px-11 pt-6 pb-11">
          <AddProviderForm onSuccess={noop} providers={[]} submitLabel="Next" />
        </div>
      </OnboardingLayout>
    </OnboardingWindowFrame>
  );
}
