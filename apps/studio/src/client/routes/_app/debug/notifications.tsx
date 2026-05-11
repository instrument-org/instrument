import { Button } from "@/client/components/ui/button";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { getDebugRoute } from "./-debug-routes";

export const Route = createFileRoute("/_app/debug/notifications")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getDebugRoute("notifications").title }],
  }),
});

function ActionCard({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <p className="text-xs font-medium text-foreground">{label}</p>
      {children}
    </div>
  );
}

function RouteComponent() {
  const testNotification = useMutation(
    rpcClient.debug.trigger.testNotification.mutationOptions(),
  );
  const testDownloadNotification = useMutation(
    rpcClient.debug.trigger.testDownloadNotification.mutationOptions(),
  );
  const testErrorNotification = useMutation(
    rpcClient.debug.trigger.testErrorNotification.mutationOptions(),
  );

  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex max-w-xl flex-col gap-3 p-6">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          System
        </p>
        <ActionCard label="Basic system notification">
          <Button
            onClick={() => {
              testNotification.mutate(undefined);
            }}
            size="sm"
          >
            Send test notification
          </Button>
        </ActionCard>

        <p className="mt-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Updates
        </p>
        <ActionCard label="Simulates a full download cycle, incrementing progress every 500ms">
          <Button
            onClick={() => {
              testDownloadNotification.mutate(undefined);
            }}
            size="sm"
          >
            Test download notification
          </Button>
        </ActionCard>
        <ActionCard label="Simulates a failed update check after a short delay">
          <Button
            onClick={() => {
              testErrorNotification.mutate(undefined);
            }}
            size="sm"
          >
            Test update error notification
          </Button>
        </ActionCard>
      </div>
    </div>
  );
}
