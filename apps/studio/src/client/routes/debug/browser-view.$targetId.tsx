import { Button } from "@/client/components/ui/button";
import { useAppTabs } from "@/client/components/window/app-tabs";
import { useTabId } from "@/client/hooks/use-active-tab";
import { ProhibitIcon } from "@phosphor-icons/react/Prohibit";
import { createFileRoute } from "@tanstack/react-router";

import { getDebugRoute } from "./-debug-routes";

export const Route = createFileRoute("/debug/browser-view/$targetId")({
  component: RouteComponent,
  head: () => ({
    meta: [
      {
        title: getDebugRoute("browserView").title,
      },
    ],
  }),
});

function RouteComponent() {
  const { targetId } = Route.useParams();
  const appTabs = useAppTabs();
  const tabId = useTabId();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <ProhibitIcon className="size-10 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">
          Browser session is no longer active
        </p>
        <p className="font-mono text-xs text-muted-foreground">{targetId}</p>
      </div>
      <Button
        onClick={() => {
          appTabs.close(tabId);
        }}
        size="sm"
        variant="outline"
      >
        Close tab
      </Button>
    </div>
  );
}
