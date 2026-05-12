import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { Toaster } from "@/client/components/ui/sonner";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isSubRoute = pathname !== "/onboarding" && pathname !== "/onboarding/";

  return (
    <OnboardingLayout
      onBack={() => void navigate({ to: "/onboarding" })}
      showBack={isSubRoute}
    >
      <Outlet />
      <Toaster position="top-center" />
    </OnboardingLayout>
  );
}
