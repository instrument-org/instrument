import { OnboardingZoomRoot } from "@/client/components/onboarding/zoom-root";
import { WindowBorder } from "@/client/components/window-border";
import { resolveWorkspaceServerUrl } from "@/client/lib/asset-base-url";
import { ICON_CONTEXT_VALUE } from "@/client/lib/icon-context";
import { queryClient, router } from "@/client/router";
import { IconContext } from "@phosphor-icons/react/dist/lib/context";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

// Resolve the workspace server origin once at boot so asset URLs derive locally
// from a task id. A failure is loud (consumers still get a best-effort URL, not
// a crash). Deliberately not awaited: this must not block module eval / render.

void resolveWorkspaceServerUrl();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <IconContext.Provider value={ICON_CONTEXT_VALUE}>
        <OnboardingZoomRoot>
          <RouterProvider router={router} />
        </OnboardingZoomRoot>
        {/* Outside the zoom root, so it stays a single hairline at every UI
          zoom. The orchestrator window is the frameless one of the two this
          root serves; onboarding keeps the system's frame and its edge. */}
        {window.api.windowType === "orchestrator" && <WindowBorder />}
      </IconContext.Provider>
    </QueryClientProvider>
  );
}
