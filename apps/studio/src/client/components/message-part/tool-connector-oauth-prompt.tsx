import {
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { PlugsConnectedIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { rpcClient } from "../../rpc/client";
import { Button } from "../ui/button";
import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";

type OAuthPromptPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-connector_oauth_prompt" }
>;

export function ToolConnectorOAuthPrompt({
  part,
  taskId,
}: {
  part: OAuthPromptPart;
  taskId: TaskId;
}) {
  const [waiting, setWaiting] = useState(false);
  const slug = part.input?.slug ?? "";

  const resolveMutation = useMutation(
    rpcClient.workspace.message.resolveInteractiveToolCall.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't hand the result back to the agent", {
          description: error.message,
          position: "bottom-center",
        });
      },
    }),
  );

  // The resolve mutation itself is the one-shot guard: callers check isIdle so
  // the auto-connected effect and the buttons can't double-resolve.
  const resolve = (state: "connected" | "dismissed") => {
    resolveMutation.mutate({
      id: taskId,
      resolution: {
        output: { slug, state },
        toolName: "connector_oauth_prompt",
      },
      toolCallId: part.toolCallId,
    });
  };

  const startOAuthMutation = useMutation(
    rpcClient.connectors.startOAuth.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't start sign-in", {
          description: error.message,
          position: "bottom-center",
        });
      },
      onSuccess: (result) => {
        if (result.status === "connected") {
          resolve("connected");
        } else {
          // Browser opened; wait for the callback to enable the connector.
          setWaiting(true);
        }
      },
    }),
  );

  // While waiting for the browser sign-in and the call is still open, poll the
  // connector list; when this connector flips to enabled, the callback
  // finished -- resolve the tool call (guarded to fire once).
  const stillOpen = part.state === "input-available";
  const { data: connectors } = useQuery({
    ...rpcClient.connectors.list.queryOptions(),
    refetchInterval: waiting && stillOpen ? 1500 : false,
  });
  const isConnected =
    connectors?.connectors.some(
      (connector) => connector.slug === slug && connector.enabled,
    ) ?? false;

  useEffect(() => {
    if (waiting && isConnected && resolveMutation.isIdle) {
      resolve("connected");
    }
    // resolve is a stable one-shot guarded by resolveMutation.isIdle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, isConnected, resolveMutation.isIdle]);

  if (!part.input) {
    return null;
  }

  const output = part.state === "output-available" ? part.output : undefined;

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <PlugsConnectedIcon className="size-3.5" />
          Connect · {slug}
        </p>
      </ToolCardHeader>

      <ToolCardSection maxHeight="max-h-64">
        <p className="mb-3 text-sm">{part.input.reason}</p>

        {part.state === "input-available" && (
          <div className="flex items-center gap-2">
            <Button
              disabled={startOAuthMutation.isPending || waiting}
              onClick={() => {
                startOAuthMutation.mutate({ slug });
              }}
              size="sm"
            >
              {waiting ? "Waiting for sign-in…" : "Connect"}
            </Button>
            {/* Always dismissable -- if the user declines in the browser or
                closes it, this is the only way out of the waiting state. */}
            <Button
              onClick={() => {
                resolve("dismissed");
              }}
              size="sm"
              variant="outline"
            >
              {waiting ? "Cancel" : "Not now"}
            </Button>
          </div>
        )}

        {output && (
          <p className="text-sm text-muted-foreground">
            {output.state === "connected"
              ? "Connected. Tokens are stored encrypted and refresh automatically."
              : "Declined."}
          </p>
        )}
      </ToolCardSection>
    </ToolCard>
  );
}
