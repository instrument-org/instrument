import { OnboardingZoomRoot } from "@/client/components/onboarding/zoom-root";
import { resolveComputerFileBase } from "@/client/lib/computer-file-url";
import { ICON_CONTEXT_VALUE } from "@/client/lib/icon-context";
import { queryClient, router } from "@/client/router";
import { IconContext } from "@phosphor-icons/react/dist/lib/context";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

// Resolve the computer file channel once at boot so file URLs derive locally
// from a host path. A failure is loud (consumers still get a best-effort URL,
// not a crash). Deliberately not awaited: this must not block module eval /
// render.

void resolveComputerFileBase();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <IconContext.Provider value={ICON_CONTEXT_VALUE}>
        <OnboardingZoomRoot>
          <RouterProvider router={router} />
        </OnboardingZoomRoot>
      </IconContext.Provider>
    </QueryClientProvider>
  );
}
