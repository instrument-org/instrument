import { useAppTabs } from "@/client/components/window/app-tabs";
import { useGroupTab } from "@/client/components/window/group-tab";
import { askedAddressOf } from "@/client/components/window/missing-page";
import { useTabId } from "@/client/hooks/use-active-tab";
import { useCanGoBack, useRouter } from "@tanstack/react-router";
import { APP_NAME } from "@instrument-org/shared";
import { useMemo } from "react";

import { ErrorCardShell } from "./error-card-shell";
import { ReportErrorButton } from "./report-error-button";
import { Button } from "./ui/button";

/**
 * What a tab shows at an address no screen answers: an old link, or one a
 * bug built. The omnibar over it shows the address it was asked for, so the
 * card leaves it out, and the report sends that address (`askedAddressOf`)
 * as the error's message, so a link the app built wrong reaches the reports.
 * In the app window it is
 * a group's tab, and its ways out act on that tab alone; the window's own
 * tab draws nothing at such an address, since the window moves it into a
 * group's tab (`useTabGroupUpkeep`).
 */
export function NotFoundRouteComponent() {
  const groupTab = useGroupTab();
  if (groupTab === null && window.api.windowType === "app") {
    return null;
  }
  return <NotFoundCard />;
}

function NotFoundCard() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const groupTab = useGroupTab();
  const tabId = useTabId();
  const appTabs = useAppTabs();
  const address = askedAddressOf(router.state.location.href);
  // One error per address: the automatic report sends once per error object.
  const error = useMemo(() => notFoundError(address), [address]);

  return (
    <div className="flex min-h-full min-w-0 flex-1 items-center justify-center p-6">
      <ErrorCardShell
        actions={
          <div className="flex gap-x-2">
            {canGoBack ? (
              <Button
                onClick={() => {
                  router.history.back();
                }}
                variant="secondary"
              >
                Go back
              </Button>
            ) : null}
            <Button
              onClick={() => {
                if (groupTab) {
                  groupTab.close();
                } else {
                  appTabs.close(tabId);
                }
              }}
              variant="secondary"
            >
              Close tab
            </Button>
            <ReportErrorButton error={error} surface="not-found" />
          </div>
        }
        description={`If a link in ${APP_NAME} brought you here, please report it.`}
        title="Page not found"
      />
    </div>
  );
}

function notFoundError(address: string) {
  const error = new Error(`No screen at ${address}`);
  error.name = "NotFoundError";
  return error;
}
