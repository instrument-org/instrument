import { Dialog } from "@/client/components/ui/dialog";
import { Toaster } from "@/client/components/ui/sonner";
import { useUpdateNotifications } from "@/client/hooks/use-update-notifications";
import { dismissStudioOverlay } from "@/client/lib/studio-overlay";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/studio-overlay")({
  component: AppModalLayout,
  // Bare `/studio-overlay` has no UI of its own; default to the login kind so the
  // controller (and any direct navigation) lands on a real child route.
  loader: ({ location }) => {
    if (location.pathname === "/studio-overlay") {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: "/studio-overlay/login" });
    }
  },
});

/**
 * Shared Radix dialog context for every studio-overlay kind. The dialog is always
 * open (the whole WebContentsView is torn down on close), so Escape and
 * overlay clicks route through onOpenChange to dismiss. Each kind renders its
 * own DialogContent (which brings the overlay + close button) into the Outlet.
 * The top strip stays draggable so window controls remain usable beneath it.
 */
function AppModalLayout() {
  useUpdateNotifications();

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          dismissStudioOverlay();
        }
      }}
      open
    >
      <div className="fixed inset-x-0 top-0 z-50 h-9 [-webkit-app-region:drag]" />
      <Outlet />
      {/* Offset below the draggable top strip (h-9 = 36px) so the drag region
          doesn't swallow clicks on a toast's close button. */}
      <Toaster offset={{ top: "3rem" }} position="top-center" />
    </Dialog>
  );
}
