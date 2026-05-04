import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { getDebugRoute } from "./-debug-routes";

export const Route = createFileRoute("/_app/debug/errors")({
  component: RouteComponent,
  head: () => ({
    meta: [
      {
        title: getDebugRoute("errors").title,
      },
    ],
  }),
});

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
      <div className="grid w-full grid-cols-1 gap-8 p-8">
        <Card>
          <CardHeader>
            <CardTitle>IPC / RPC Errors</CardTitle>
            <CardDescription>
              Trigger errors in the main process over the IPC bridge and observe
              how they surface in the renderer
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                <strong>Known error</strong> — the main process throws a typed
                oRPC error (e.g. ORPCError). The renderer receives a structured
                error object with a known code and message.
              </p>
              <Button
                onClick={() => {
                  knownErrorMutation.mutate({ type: "known" });
                }}
                variant="destructive"
              >
                Throw Known IPC Error
              </Button>
              {knownErrorMutation.error && (
                <p className="text-sm text-destructive">
                  {knownErrorMutation.error.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                <strong>Unknown error</strong> — the main process throws a plain
                untyped Error. The renderer receives a generic fallback message
                since the error type is not recognized by oRPC.
              </p>
              <Button
                onClick={() => {
                  unknownErrorMutation.mutate({ type: "unknown" });
                }}
                variant="destructive"
              >
                Throw Unknown IPC Error
              </Button>
              {unknownErrorMutation.error && (
                <p className="text-sm text-destructive">
                  {unknownErrorMutation.error.message}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Client-Side Errors</CardTitle>
            <CardDescription>
              Trigger errors directly in the renderer process to test
              client-side error boundaries and reporting
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                <strong>Synchronous throw</strong> — throws a plain Error
                synchronously inside a React event handler. Caught and displayed
                here rather than crashing the component tree.
              </p>
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
                variant="destructive"
              >
                Throw Client Error
              </Button>
              {clientError && (
                <p className="text-sm text-destructive">
                  {clientError.message}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
