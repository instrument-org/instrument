import {
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { LockKeyIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { rpcClient } from "../../rpc/client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";

type CredentialPromptPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-connector_credential_prompt" }
>;

export function ToolConnectorCredentialPrompt({
  part,
  taskId,
}: {
  part: CredentialPromptPart;
  taskId: TaskId;
}) {
  const [value, setValue] = useState("");

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

  const setCredentialMutation = useMutation(
    rpcClient.connectors.setCredential.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't save the credential", {
          description: error.message,
          position: "bottom-center",
        });
      },
    }),
  );

  if (!part.input) {
    return null;
  }
  const slug = part.input.slug ?? "";

  const resolve = (state: "denied" | "granted") => {
    resolveMutation.mutate({
      id: taskId,
      resolution: {
        output: { slug, state },
        toolName: "connector_credential_prompt",
      },
      toolCallId: part.toolCallId,
    });
  };

  const grant = async () => {
    const secret = value.trim();
    if (secret === "") {
      return;
    }
    // The secret goes straight to the encrypted store over RPC; the agent is
    // only told "granted". Clear the field before resolving so the value
    // lives in renderer memory as briefly as possible.
    try {
      await setCredentialMutation.mutateAsync({ slug, value: secret });
    } catch {
      return;
    }
    setValue("");
    resolve("granted");
  };

  const isPending =
    part.state === "input-available" &&
    !resolveMutation.isPending &&
    !resolveMutation.isSuccess;
  const output = part.state === "output-available" ? part.output : undefined;

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <LockKeyIcon className="size-3.5" />
          Credential requested · {slug}
        </p>
      </ToolCardHeader>

      <ToolCardSection maxHeight="max-h-64">
        <p className="mb-3 text-sm">{part.input.reason}</p>

        {isPending && (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              className="h-8 flex-1 font-mono text-xs"
              onChange={(event) => {
                setValue(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void grant();
                }
              }}
              placeholder="Paste API key or token"
              type="password"
              value={value}
            />
            <Button
              disabled={value.trim() === "" || setCredentialMutation.isPending}
              onClick={() => {
                void grant();
              }}
              size="sm"
            >
              Save
            </Button>
            <Button
              onClick={() => {
                resolve("denied");
              }}
              size="sm"
              variant="outline"
            >
              Not now
            </Button>
          </div>
        )}

        {output && (
          <p className="text-sm text-muted-foreground">
            {output.state === "granted"
              ? "Credential saved to the encrypted store. The agent never sees the value."
              : "Declined."}
          </p>
        )}
      </ToolCardSection>
    </ToolCard>
  );
}
