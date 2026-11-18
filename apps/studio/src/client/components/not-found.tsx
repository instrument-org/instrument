import { useAppTabs } from "@/client/components/window/app-tabs";
import { useTabId } from "@/client/hooks/use-active-tab";
import { useCanGoBack, useRouter } from "@tanstack/react-router";
import { APP_NAME } from "@instrument-org/shared";
import { useMemo } from "react";

import { CopyButton } from "./copy-button";
import { ErrorCardShell } from "./error-card-shell";
import { ReportErrorButton } from "./report-error-button";
import { Button } from "./ui/button";

/**
 * What a tab shows at an address no screen answers: an old link, or one a
 * bug built. The address is selectable and copyable, and the report sends it
 * as the error's message, so a link the app built wrong reaches the reports.
 */
export function NotFoundRouteComponent() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const tabId = useTabId();
  const appTabs = useAppTabs();
  const href = router.state.location.href;
  // One error per address: the automatic report sends once per error object.
  const error = useMemo(() => notFoundError(href), [href]);

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
                appTabs.close(tabId);
              }}
              variant="secondary"
            >
              Close tab
            </Button>
            <ReportErrorButton error={error} surface="not-found" />
          </div>
        }
        description={`If a link in ${APP_NAME} brought you here, let us know so we can fix it.`}
        title="Page not found"
      >
        <div className="group/address relative rounded-lg bg-muted px-3 py-2.5 select-text">
          <code className="block pr-8 font-mono text-[13px] break-all">
            {href}
          </code>
          <div className="absolute top-2 right-2 opacity-0 group-hover/address:opacity-100">
            <CopyButton
              className="size-6 rounded-sm p-0.5 text-muted-foreground/60 hover:bg-foreground/5 hover:text-foreground"
              iconSize={13}
              label="Copy address"
              onCopy={() => navigator.clipboard.writeText(href)}
              tooltip="Copy address"
            />
          </div>
        </div>
      </ErrorCardShell>
    </div>
  );
}

function notFoundError(href: string) {
  const error = new Error(`No screen at ${href}`);
  error.name = "NotFoundError";
  return error;
}
