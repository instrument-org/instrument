import { Button } from "@/client/components/ui/button";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";

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
  const sendTestNotification = useMutation(
    rpcClient.debug.trigger.testNotification.mutationOptions(),
  );
  const testDownloadNotification = useMutation(
    rpcClient.debug.trigger.testDownloadNotification.mutationOptions(),
  );
  const testErrorNotification = useMutation(
    rpcClient.debug.trigger.testErrorNotification.mutationOptions(),
  );
  const { data: testNotification } = useQuery(
    rpcClient.debug.live.testNotification.experimental_streamedOptions(),
  );

  useEffect(() => {
    if (testNotification && testNotification.length > 0) {
      toast.info("Test notification", {
        closeButton: true,
      });
    }
  }, [testNotification]);

  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex max-w-xl flex-col gap-3 p-6">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          System
        </p>
        <ActionCard label="Basic system notification">
          <Button
            onClick={() => {
              sendTestNotification.mutate(undefined);
            }}
            size="sm"
          >
            Send test notification
          </Button>
        </ActionCard>
        <ActionCard label="System notification with a button">
          <Button
            onClick={() => {
              toast.success(`${APP_NAME} updated to 1.5.0`, {
                action: {
                  label: "What's new",
                  onClick: () => {},
                },
              });
            }}
            size="sm"
          >
            Test update success notification
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
