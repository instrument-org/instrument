import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { Toaster } from "@/client/components/ui/sonner";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { z } from "zod";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingRoute,
  validateSearch: z.object({ success: z.boolean().optional() }),
});

const DevPanel = lazy(() =>
  import("@/client/components/dev-panel").then((m) => ({
    default: m.DevPanel,
  })),
);

function OnboardingRoute() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { success } = Route.useSearch();
  const isSubRoute = pathname !== "/onboarding" && pathname !== "/onboarding/";
  const isDeveloperMode = useDeveloperMode();

  return (
    <OnboardingLayout
      onBack={() => void navigate({ to: "/onboarding" })}
      showBack={isSubRoute && !success}
    >
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
