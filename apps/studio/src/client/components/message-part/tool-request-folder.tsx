import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import {
  MOUNT,
  type SessionMessagePart,
  type ChatId,
} from "@instrument-org/workspace/client";
import { FolderOpenIcon } from "@phosphor-icons/react/FolderOpen";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "../ui/button";
import { ToolCard, ToolCardEmpty, ToolCardSection } from "./tool-card";
import { useHasLiveSession } from "./use-live-session";

type RequestFolderPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-request_folder" }
>;

/**
 * The agent asking for a folder. While the call waits, the card carries the
 * reason and two buttons: one opens the Mac's own dialog, attaches what was
 * picked to this conversation, and answers the call with the mount; the other
 * answers that the user declined. Once answered it says what happened.
 *
 * The dialog is a sheet over this window, so the card is out of sight while
 * it is up: the reason goes into the sheet as its message, and its button
 * says Allow.
 */
export function ToolRequestFolder({
  part,
  chatId,
}: {
  part: RequestFolderPart;
  chatId: ChatId;
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
    rpcClient.workspace.chats.state.attachFolder.mutationOptions({
      onError: (error) => {
        toast.error("Could not attach the folder", {
          description: error.message,
        });
      },
    }),
  );
  const isWaitedOn = useHasLiveSession(part.metadata.sessionId);

  if (!part.input) {
    return <ToolCardEmpty message="The request has not arrived yet." />;
  }

  const { folder: refusedFolder, reason } = part.input;
  const isUnanswered = part.state === "input-available";
  const isPending = isUnanswered && isWaitedOn;

  const choose = async () => {
    const refused = refusedFolder
      ? await refusedHostPath(chatId, refusedFolder)
      : undefined;
    const picked = await rpcClient.utils.showFolderPicker.call({
      buttonLabel: "Allow",
      message: `${APP_NAME} asked for a folder: ${reason ?? ""}`,
      ...(refused && { startingAt: refused }),
    });
    if (!picked) {
      return;
    }
    // The refused folder picked as it is: the pick is what lets the app in,
    // and the conversation already reaches it at the path it named.
    const mountPoint =
      refused && refusedFolder && picked.path === refused
        ? refusedFolder
        : `${MOUNT.attachedFolders}/${
            (await attach.mutateAsync({ id: chatId, path: picked.path }))
              .mountName
          }`;
    answer.mutate({
      id: chatId,
      output: { mountPoint, status: "granted" },
      toolCallId: part.toolCallId,
      toolName: "request_folder",
    });
  };

  const decline = () => {
    answer.mutate({
      id: chatId,
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
          <span>{reason}</span>
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
        ) : isUnanswered ? (
          // Nothing is waiting for this any more, so the buttons are gone:
          // answering one would attach a folder and tell nobody.
          <p className="mt-2 text-xs text-muted-foreground">
            This request ended without an answer.
          </p>
        ) : part.state === "output-available" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {part.output.status === "granted"
              ? `You attached "${part.output.mountPoint.slice(MOUNT.attachedFolders.length + 1)}".`
              : "You declined."}
          </p>
        ) : null}
      </ToolCardSection>
    </ToolCard>
  );
}

/**
 * Where on disk a folder the conversation reaches is, given the path it is
 * mounted at: the mount it sits in, and the rest of the path inside that.
 */
async function refusedHostPath(
  chatId: ChatId,
  mountPath: string,
): Promise<string | undefined> {
  const prefix = `${MOUNT.attachedFolders}/`;
  if (!mountPath.startsWith(prefix)) {
    return undefined;
  }
  const inside = mountPath.slice(prefix.length).replace(/\/+$/, "");
  const { attachedFolders } = await rpcClient.workspace.chats.state.get.call({
    id: chatId,
  });
  const mount = Object.values(attachedFolders ?? {})
    .filter(
      ({ mountName }) =>
        inside === mountName || inside.startsWith(`${mountName}/`),
    )
    .toSorted((a, b) => b.mountName.length - a.mountName.length)[0];
  if (!mount) {
    return undefined;
  }
  const rest = inside.slice(mount.mountName.length);
  return `${mount.path}${rest}`;
}
