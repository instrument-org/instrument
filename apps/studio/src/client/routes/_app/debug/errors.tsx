import { Button } from "@/client/components/ui/button";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { getDebugRoute } from "./-debug-routes";

export const Route = createFileRoute("/_app/debug/errors")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getDebugRoute("errors").title }],
  }),
});

function ActionCard({
  children,
  error,
  label,
}: {
  children: React.ReactNode;
  error?: null | string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <p className="text-xs font-medium text-foreground">{label}</p>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function RouteComponent() {
  const [clientError, setClientError] = useState<Error | null>(null);

  const knownErrorMutation = useMutation(
    rpcClient.debug.throwError.mutationOptions(),
  );
  const unknownErrorMutation = useMutation(
    rpcClient.debug.throwError.mutationOptions(),
  );

  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex max-w-xl flex-col gap-3 p-6">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          IPC / RPC
        </p>
        <ActionCard
          error={knownErrorMutation.error?.message}
          label="Known error — typed oRPC error with a known code and message"
        >
          <Button
            onClick={() => {
              knownErrorMutation.mutate({ type: "known" });
            }}
            size="sm"
            variant="destructive"
          >
            Throw Known IPC Error
          </Button>
        </ActionCard>
        <ActionCard
          error={unknownErrorMutation.error?.message}
          label="Unknown error — untyped Error, renderer receives a generic fallback"
        >
          <Button
            onClick={() => {
              unknownErrorMutation.mutate({ type: "unknown" });
            }}
            size="sm"
            variant="destructive"
          >
            Throw Unknown IPC Error
          </Button>
        </ActionCard>

        <p className="mt-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Client-Side
        </p>
        <ActionCard
          error={clientError?.message}
          label="Synchronous throw — caught in event handler, does not crash the tree"
        >
          <Button
            onClick={() => {
              try {
                throw new Error("Synchronous client-side error");
              } catch (error) {
                setClientError(
                  error instanceof Error ? error : new Error(String(error)),
                );
              }
            }}
            size="sm"
            variant="destructive"
          >
            Throw Client Error
          </Button>
        </ActionCard>
      </div>
    </div>
  );
}
