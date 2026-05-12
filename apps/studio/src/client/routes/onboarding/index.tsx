import { OnboardingWelcomeScreen } from "@/client/components/onboarding/welcome-screen";
import { useSignInSocial } from "@/client/hooks/use-sign-in-social";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding/")({
  component: OnboardingIndex,
});

function OnboardingIndex() {
  const navigate = useNavigate();
  const { error } = useSignInSocial();
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const { data: providerConfigs } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );
  const hasProvider = (providerConfigs?.length ?? 0) > 0;
  const isSetupComplete = hasToken === true || hasProvider;

  return (
    <OnboardingWelcomeScreen
      error={error}
      isSetupComplete={isSetupComplete}
      onAddProvider={() => void navigate({ to: "/onboarding/providers" })}
      onContinue={() => void rpcClient.onboarding.complete.call()}
    />
  );
}
