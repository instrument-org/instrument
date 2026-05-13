import { OnboardingThemeScreen } from "@/client/components/onboarding/theme-screen";
import { rpcClient } from "@/client/rpc/client";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding/theme")({
  component: OnboardingTheme,
});

function OnboardingTheme() {
  return (
    <OnboardingThemeScreen
      onContinue={() => void rpcClient.onboarding.complete.call()}
    />
  );
}
