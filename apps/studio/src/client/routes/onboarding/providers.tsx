import { AddProviderForm } from "@/client/components/add-provider/form";
import { OnboardingSuccessScreen } from "@/client/components/onboarding/success-screen";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/onboarding/providers")({
  component: OnboardingProviders,
  validateSearch: z.object({ success: z.boolean().optional() }),
});

function OnboardingProviders() {
  const { data: providerConfigs } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );
  const navigate = useNavigate();
  const { success } = Route.useSearch();

  if (success) {
    return (
      <OnboardingSuccessScreen
        onContinue={() => void navigate({ to: "/onboarding/theme" })}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-11 pt-6 pb-11">
      <AddProviderForm
        onSuccess={() => {
          void navigate({
            search: { success: true },
            to: "/onboarding/providers",
          });
        }}
        providers={providerConfigs ?? []}
        submitLabel="Next"
      />
    </div>
  );
}
