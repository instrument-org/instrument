import { OnboardingSuccessScreen } from "@/client/components/onboarding/success-screen";
import { OnboardingThemeScreen } from "@/client/components/onboarding/theme-screen";
import { rpcClient } from "@/client/rpc/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/onboarding/theme")({
  component: OnboardingTheme,
  validateSearch: z.object({ success: z.boolean().optional() }),
});

function OnboardingTheme() {
  const navigate = useNavigate();
  const { success } = Route.useSearch();

  if (success) {
    return (
      <OnboardingSuccessScreen
        onContinue={() =>
          void navigate({ replace: true, search: {}, to: "/onboarding/theme" })
        }
      />
    );
  }

  return (
    <OnboardingThemeScreen
      onContinue={() => void rpcClient.onboarding.complete.call()}
    />
  );
}
