import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { Toaster } from "@/client/components/ui/sonner";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingRoute,
  validateSearch: z.object({ success: z.boolean().optional() }),
});

function OnboardingRoute() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { success } = Route.useSearch();
  const isSubRoute = pathname !== "/onboarding" && pathname !== "/onboarding/";

  return (
    <OnboardingLayout
      onBack={() => void navigate({ to: "/onboarding" })}
      showBack={isSubRoute && !success}
    >
      <Outlet />
      <Toaster position="top-center" />
    </OnboardingLayout>
  );
}
