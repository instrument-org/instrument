import {
  type ProviderSetupPage,
  ProviderSetupScreen,
} from "@/client/components/onboarding/provider-setup-screen";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/onboarding/")({
  beforeLoad: ({ context: { hasProviders, hasToken } }) => {
    if (hasToken || hasProviders) {
      // oxlint-disable-next-line typescript/only-throw-error
      throw redirect({ to: "/onboarding/theme" });
    }
  },
  component: OnboardingIndex,
});

function OnboardingIndex() {
  const navigate = useNavigate();
  const [page, setPage] = useState<ProviderSetupPage>("welcome");

  return (
    <ProviderSetupScreen
      onAddProvider={() => void navigate({ to: "/onboarding/providers" })}
      onContinue={() =>
        void navigate({ replace: true, to: "/onboarding/theme" })
      }
      onLoginSuccess={() =>
        void navigate({
          replace: true,
          search: { success: true },
          to: "/onboarding/theme",
        })
      }
      onPageChange={setPage}
      page={page}
    />
  );
}
