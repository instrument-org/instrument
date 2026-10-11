import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import {
  type SessionMessagePart,
  type ChatId,
} from "@instrument-org/workspace/client";
import { FolderOpenIcon } from "@phosphor-icons/react/FolderOpen";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { z } from "zod";
import { hostPathFromShellPath, folderLabel } from "@/client/lib/path-utils";
import { toast } from "@/client/lib/toast";
import { isWindows } from "@/client/lib/utils";

import { openSettings } from "@/client/atoms/settings-modal";

import { Button } from "../ui/button";
import { ToolCard, ToolCardEmpty, ToolCardSection } from "./tool-card";
import { useHasLiveSession } from "./use-live-session";

type RequestFolderPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-request_folder" }
>;

/**
 * The agent asking for a folder. Given the folder it needs, the card offers
 * it as it is, for this chat or always, beside the Mac's own panel for
 * picking another; without one, the panel alone. Once answered it says what
 * happened.
 *
 * Allowing a folder macOS guards raises the system's own ask beside the card.
 * Where macOS already refused, the panel opens at that folder instead, since
 * a pick there is what lets the app back in.
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
        toast.error("Couldn't send your answer", { cause: error });
      },
    }),
  );
  const grant = useMutation(
    rpcClient.workspace.chats.folders.grant.mutationOptions(),
  );
  const isWaitedOn = useHasLiveSession(part.metadata.sessionId);
  // A folder the person already closed in Settings gets no card: they have
  // answered, so the agent is told no at once and they see why.
  const closedPath = part.input?.folder
    ? hostPathFromShellPath(part.input.folder, isWindows())
    : undefined;
  const reach = useQuery({
    ...rpcClient.workspace.permissions.reach.queryOptions({
      input: { id: chatId, path: closedPath ?? "" },
    }),
    enabled: closedPath !== undefined,
  });
  const isClosed = reach.data?.level === "never";
  const declineClosed =
    isClosed &&
    isWaitedOn &&
    part.state === "input-available" &&
    !answer.isPending &&
    !answer.isSuccess;
  useEffect(() => {
    if (declineClosed) {
      answer.mutate({
        id: chatId,
        output: { closed: true, status: "declined" },
        toolCallId: part.toolCallId,
        toolName: "request_folder",
      });
    }
  }, [declineClosed, answer, chatId, part.toolCallId]);

  if (!part.input) {
    return <ToolCardEmpty message="The request has not arrived yet." />;
  }

  const { folder: askedFolder, reason } = part.input;
  const isUnanswered = part.state === "input-available";
  const isPending = isUnanswered && isWaitedOn;
  const isBusy = grant.isPending || answer.isPending;

  const granted = (path: string) => {
    answer.mutate({
      id: chatId,
      output: { path, status: "granted" },
      toolCallId: part.toolCallId,
      toolName: "request_folder",
    });
  };

  const choose = async (startingAt?: string) => {
    const picked = await rpcClient.utils.showFolderPicker.call({
      buttonLabel: "Allow",
      message: `${APP_NAME} asked for a folder: ${reason ?? ""}`,
      ...(startingAt && { startingAt }),
    });
    if (!picked) {
      return;
    }
    try {
      granted(
        (await grant.mutateAsync({ id: chatId, path: picked.path })).path,
      );
    } catch (error) {
      toast.error("Couldn't allow the folder", { cause: error });
    }
  };

  const allow = async (always: boolean) => {
    const hostPath = askedFolder
      ? hostPathFromShellPath(askedFolder, isWindows())
      : undefined;
    if (!hostPath) {
      await choose();
      return;
    }
    try {
      granted(
        (await grant.mutateAsync({ always, id: chatId, path: hostPath })).path,
      );
    } catch (error) {
      if (isSystemRefusal(error)) {
        await choose(hostPath);
        return;
      }
      toast.error("Couldn't allow the folder", { cause: error });
    }
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
        {isClosed && askedFolder ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {`You marked "${folderLabel(askedFolder)}" Not allowed. `}
            <button
              className="underline underline-offset-2"
              onClick={() => {
                openSettings({ tab: "Permissions" });
              }}
              type="button"
            >
              Change it in Settings
            </button>
          </p>
        ) : isPending ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {askedFolder ? (
              <>
                <Button
                  disabled={isBusy}
                  onClick={() => {
                    void allow(false);
                  }}
                  size="sm"
                >
                  Allow in this chat
                </Button>
                <Button
                  disabled={isBusy}
                  onClick={() => {
                    void allow(true);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  Always allow
                </Button>
              </>
            ) : null}
            <Button
              disabled={isBusy}
              onClick={() => {
                void choose();
              }}
              size="sm"
              variant={askedFolder ? "ghost" : "default"}
            >
              Choose a folder…
            </Button>
            <Button
              disabled={isBusy}
              onClick={decline}
              size="sm"
              variant="ghost"
            >
              Not now
            </Button>
          </div>
        ) : isUnanswered ? (
          // Nothing is waiting for this any more, so the buttons are gone:
          // answering one would allow a folder and tell nobody.
          <p className="mt-2 text-xs text-muted-foreground">
            This request ended without an answer.
          </p>
        ) : part.state === "output-available" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {part.output.status === "granted"
              ? `You allowed "${folderLabel(part.output.path)}".`
              : "You said not now."}
          </p>
        ) : null}
      </ToolCardSection>
    </ToolCard>
  );
}

/** Whether a grant failed because macOS itself keeps the app out. */
function isSystemRefusal(error: unknown): boolean {
  return (
    error instanceof ORPCError &&
    z.object({ refusedBy: z.literal("system") }).safeParse(error.data).success
  );
}
