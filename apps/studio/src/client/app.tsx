import { OnboardingZoomRoot } from "@/client/components/onboarding/zoom-root";
import { resolveWorkspaceServerUrl } from "@/client/lib/asset-base-url";
import { queryClient, router } from "@/client/router";
import { IconContext, type IconProps } from "@phosphor-icons/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

const IconContextValue: IconProps = {
  weight: "bold",
};

// Resolve the workspace server origin once at boot so asset URLs derive locally
// from a task id. A failure is loud (consumers still get a best-effort URL, not
// a crash). Deliberately not awaited: this must not block module eval / render.

void resolveWorkspaceServerUrl();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <IconContext.Provider value={IconContextValue}>
        <OnboardingZoomRoot>
          <RouterProvider router={router} />
        </OnboardingZoomRoot>
      </IconContext.Provider>
    </QueryClientProvider>
  );
}
