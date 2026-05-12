import { AddProviderForm } from "@/client/components/add-provider/form";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding/providers")({
  component: OnboardingProviders,
});

function OnboardingProviders() {
  const { data: providerConfigs } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );

  const handleSuccess = () => {
    void rpcClient.onboarding.complete.call();
  };

  return (
    <div className="flex-1 overflow-y-auto px-11 pt-6 pb-11">
      <AddProviderForm
        onSuccess={handleSuccess}
        providers={providerConfigs ?? []}
        submitLabel="Next"
      />
    </div>
  );
}
