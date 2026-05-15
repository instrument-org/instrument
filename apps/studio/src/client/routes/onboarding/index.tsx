import {
  type ProviderSetupPage,
  ProviderSetupScreen,
} from "@/client/components/onboarding/provider-setup-screen";
import { useLoginSocial } from "@/client/hooks/use-login-social";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/onboarding/")({
  beforeLoad: async () => {
    const [{ data: hasToken }, { data: providers }] = await Promise.all([
      safe(rpcClient.auth.hasToken.call()),
      safe(rpcClient.providerConfig.list.call()),
    ]);
    // Skip welcome if already set up (e.g. user navigated back)
    if (hasToken === true || (providers && providers.length > 0)) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: "/onboarding/theme" });
    }
  },
  component: OnboardingIndex,
});

function OnboardingIndex() {
  const navigate = useNavigate();
  const { error, login } = useLoginSocial();
  const [page, setPage] = useState<ProviderSetupPage>("welcome");

  return (
    <ProviderSetupScreen
      error={error}
      onAddProvider={() => void navigate({ to: "/onboarding/providers" })}
      onContinue={() => void navigate({ to: "/onboarding/theme" })}
      onLogin={login}
      onLoginSuccess={() => void navigate({ to: "/onboarding/theme" })}
      onPageChange={setPage}
      page={page}
    />
  );
}
