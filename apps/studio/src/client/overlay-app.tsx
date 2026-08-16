import { resolveWorkspaceServerUrl } from "@/client/lib/asset-base-url";
import { ICON_CONTEXT_VALUE } from "@/client/lib/icon-context";
import { queryClient, router } from "@/client/router";
import { IconContext } from "@phosphor-icons/react/dist/lib/context";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

void resolveWorkspaceServerUrl();

/**
 * The quick capture window's own root.
 *
 * Deliberately not `App`: that one mounts `ZoomRoot`, whose scale is shared
 * through localStorage with the main window. A launcher sized to its own
 * content cannot also be scaled by a preference set somewhere else -- the
 * window would be measured at one size and drawn at another -- and a panel that
 * grew because a different window was zoomed would be the wrong behavior even
 * if the arithmetic worked. This window is always 1x.
 */
export function OverlayApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <IconContext.Provider value={ICON_CONTEXT_VALUE}>
        <RouterProvider router={router} />
      </IconContext.Provider>
    </QueryClientProvider>
  );
}
