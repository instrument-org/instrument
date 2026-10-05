import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { type SignInOutcome } from "@/shared/sign-in-outcome";
import {
  type ProviderSetupPage,
  ProviderSetupScreen,
} from "@/client/components/onboarding/provider-setup-screen";
import { createFileRoute } from "@tanstack/react-router";
import { noop } from "radashi";
import { useState } from "react";

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
  const [page1, setPage1] = useState<ProviderSetupPage>("welcome");
  const [page2, setPage2] = useState<ProviderSetupPage>("welcome");
  return (
    <div className="flex flex-wrap gap-8">
      <OnboardingWindowFrame>
        <OnboardingLayout>
          <ProviderSetupScreen
            onBack={() => {
              setPage1("welcome");
            }}
            onContinue={noop}
            onLogin={waitForever}
            onLoginSuccess={noop}
            onPageChange={setPage1}
            page={page1}
          />
        </OnboardingLayout>
      </OnboardingWindowFrame>

      <OnboardingWindowFrame>
        <OnboardingLayout>
          <ProviderSetupScreen
            error={new Error("Login failed")}
            onBack={() => {
              setPage2("welcome");
            }}
            onContinue={noop}
            onLogin={waitForever}
            onLoginSuccess={noop}
            onPageChange={setPage2}
            page={page2}
          />
        </OnboardingLayout>
      </OnboardingWindowFrame>
    </div>
  );
}
