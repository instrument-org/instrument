import { AddProviderForm } from "@/client/components/add-provider/form";
import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { OnboardingScreen } from "@/client/components/onboarding/screen";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { noop } from "radashi";

import { getOnboardingScreen } from "../../-debug-routes";
import { OnboardingWindowFrame } from "../onboarding";

export const Route = createFileRoute("/debug/components/onboarding/providers")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getOnboardingScreen("providers").label }],
  }),
});

function RouteComponent() {
  const navigate = useNavigate();
  return (
    <OnboardingWindowFrame>
      <OnboardingLayout>
        <OnboardingScreen align="top" className="px-11 pt-17 pb-11">
          <AddProviderForm
            onBack={() =>
              void navigate({ to: getOnboardingScreen("login").to })
            }
            onSuccess={noop}
            providers={[]}
            submitLabel="Next"
          />
        </OnboardingScreen>
      </OnboardingLayout>
    </OnboardingWindowFrame>
  );
}
