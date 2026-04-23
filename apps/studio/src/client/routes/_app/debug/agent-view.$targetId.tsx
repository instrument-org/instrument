import { Button } from "@/client/components/ui/button";
import { useSelectedTabId } from "@/client/hooks/use-selected-tab-id";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { createFileRoute } from "@tanstack/react-router";
import { MonitorOffIcon } from "lucide-react";

export const Route = createFileRoute("/_app/debug/agent-view/$targetId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { targetId } = Route.useParams();
  const { closeTab } = useTabActions();
  const selectedTabId = useSelectedTabId();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <MonitorOffIcon className="size-10 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">
          Browser session is no longer active
        </p>
        <p className="font-mono text-xs text-muted-foreground">{targetId}</p>
      </div>
      <Button
        onClick={() => {
          if (selectedTabId) {
            void closeTab({ id: selectedTabId });
          }
        }}
        size="sm"
        variant="outline"
      >
        Close tab
      </Button>
    </div>
  );
}
