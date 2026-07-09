import { AddProviderForm } from "@/client/components/add-provider/form";
import { OnboardingScreen } from "@/client/components/onboarding/screen";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding/providers")({
  beforeLoad: ({ context: { hasProviders, hasToken } }) => {
    if (hasToken || hasProviders) {
      // oxlint-disable-next-line typescript/only-throw-error
      throw redirect({ to: "/onboarding/theme" });
    }
  },
  component: OnboardingProviders,
});

function OnboardingProviders() {
  const { data: providerConfigs } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );
  const navigate = useNavigate();

  return (
    <OnboardingScreen align="top" className="px-11 pt-17 pb-11">
      <AddProviderForm
        onBack={() => void navigate({ to: "/onboarding" })}
        onSuccess={() =>
          void navigate({ replace: true, to: "/onboarding/theme" })
        }
        providers={providerConfigs ?? []}
        submitLabel="Next"
      />
    </OnboardingScreen>
  );
}
