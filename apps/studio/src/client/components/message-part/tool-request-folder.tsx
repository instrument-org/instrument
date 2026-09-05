import { rpcClient } from "@/client/rpc/client";
import {
  MOUNT,
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { FolderOpenIcon } from "@phosphor-icons/react/FolderOpen";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "../ui/button";
import { ToolCard, ToolCardEmpty, ToolCardSection } from "./tool-card";

type RequestFolderPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-request_folder" }
>;

/**
 * The agent asking for a folder. While the call waits, the card carries the
 * reason and two buttons: one opens the Mac's own dialog, attaches what was
 * picked to this conversation, and answers the call with the mount; the other
 * answers that the user declined. Once answered it says what happened.
 */
export function ToolRequestFolder({
  part,
  taskId,
}: {
  part: RequestFolderPart;
  taskId: TaskId;
}) {
  const answer = useMutation(
    rpcClient.workspace.session.answerToolCall.mutationOptions({
      onError: (error) => {
        toast.error("Could not answer the request", {
          description: error.message,
        });
      },
    }),
  );
  const attach = useMutation(
    rpcClient.workspace.task.state.attachFolder.mutationOptions({
      onError: (error) => {
        toast.error("Could not attach the folder", {
          description: error.message,
        });
      },
    }),
  );

  if (!part.input) {
    return <ToolCardEmpty message="The request has not arrived yet." />;
  }

  const access = part.input.access;
  const isPending = part.state === "input-available";

  const choose = async () => {
    const picked = await rpcClient.utils.showFolderPicker.call();
    if (!picked) {
      return;
    }
    const folder = await attach.mutateAsync({
      access,
      id: taskId,
      path: picked.path,
    });
    answer.mutate({
      id: taskId,
      output: {
        access: folder.access,
        mountPoint: `${MOUNT.attachedFolders}/${folder.mountName}`,
        status: "granted",
      },
      toolCallId: part.toolCallId,
      toolName: "request_folder",
    });
  };

  const decline = () => {
    answer.mutate({
      id: taskId,
      output: { status: "declined" },
      toolCallId: part.toolCallId,
      toolName: "request_folder",
    });
  };

  return (
    <ToolCard>
      <ToolCardSection collapsedHeight={256}>
        <p className="flex items-start gap-2 text-sm">
          <FolderOpenIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{part.input.reason}</span>
        </p>
        {isPending ? (
          <div className="mt-3 flex gap-2">
            <Button
              disabled={attach.isPending || answer.isPending}
              onClick={() => {
                void choose();
              }}
              size="sm"
            >
              Choose folder…
            </Button>
            <Button
              disabled={attach.isPending || answer.isPending}
              onClick={decline}
              size="sm"
              variant="secondary"
            >
              Not now
            </Button>
          </div>
        ) : part.state === "output-available" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {part.output.status === "granted"
              ? `Attached at ${part.output.mountPoint} (${part.output.access}).`
              : "Declined."}
          </p>
        ) : null}
      </ToolCardSection>
    </ToolCard>
  );
}
