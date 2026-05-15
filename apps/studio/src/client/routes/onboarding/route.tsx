import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { Toaster } from "@/client/components/ui/sonner";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async () => {
    const [{ data: hasToken }, { data: providers }] = await Promise.all([
      safe(rpcClient.auth.hasToken.call()),
      safe(rpcClient.providerConfig.list.call()),
    ]);
    return {
      hasProviders: providers != null && providers.length > 0,
      hasToken: hasToken === true,
    };
  },
  component: OnboardingRoute,
});

const DevPanel = lazy(() =>
  import("@/client/components/dev-panel").then((m) => ({
    default: m.DevPanel,
  })),
);

function OnboardingRoute() {
  const isDeveloperMode = useDeveloperMode();

  return (
    <OnboardingLayout>
      <Outlet />
      <Toaster position="top-center" />
      {isDeveloperMode && (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      )}
    </OnboardingLayout>
  );
}
