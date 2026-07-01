import { Button } from "@/client/components/ui/button";
import { isStudioOverlayWindow } from "@/client/lib/studio-overlay";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { rpcClient } from "../rpc/client";

export function NotFoundRouteComponent() {
  const router = useRouter();
  const pathname = router.state.location.pathname;

  return <NotFoundComponent message={`Could not find page: ${pathname}`} />;
}

function NotFoundComponent({
  message,
  title = "Not Found",
}: {
  message?: string;
  title?: string;
}) {
  const { mutate: removeTab } = useMutation(
    rpcClient.tabs.close.mutationOptions(),
  );

  // In the overlay view there is no tab to close and no Dialog wrapper around a
  // 404, so route the dismissal through the overlay controller. Clicking the
  // backdrop (outside the card) dismisses too, matching DefaultErrorComponent.
  const isOverlay = isStudioOverlayWindow();

  const handleClose = () => {
    if (isOverlay) {
      void rpcClient.studioOverlay.dismiss.call();
      return;
    }
    if (window.api.tabId) {
      removeTab({ id: window.api.tabId });
    }
  };

  return (
    <div
      className="flex min-h-full flex-col items-center justify-center space-y-4 p-6"
      onClick={
        isOverlay
          ? (event) => {
              if (event.target === event.currentTarget) {
                void rpcClient.studioOverlay.dismiss.call();
              }
            }
          : undefined
      }
    >
      <div className="text-center">
        <h2 className="text-lg font-semibold text-muted-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <Button className="mt-4" onClick={handleClose} variant="outline">
          {isOverlay ? "Close" : "Close tab"}
        </Button>
      </div>
    </div>
  );
}
