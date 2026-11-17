import { useTheme } from "@/client/components/theme-provider";
import { useAgentSessionStatus } from "@/client/hooks/use-agent-session-status";
import { getComputerThumbnailUrl } from "@/client/lib/computer-file-url";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type ChatId,
  nameOfPath,
  type StoreId,
} from "@instrument-org/workspace/client";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { MESSAGE_FOOTER_ICON_SIZE, SHARED } from "../lib/styles";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { FileMark } from "./window/file-mark";

/** How many names the line about files Undo leaves spells out. */
const MOST_NAMED = 3;

/**
 * The chat's replies Undo would change a file for. Read again each time the
 * chat stops working, since a turn keeps its versions as it ends; every
 * footer shares the one read.
 */
function useUndoableReplies(chatId: ChatId) {
  const query = useQuery(
    rpcClient.workspace.chats.undoableReplies.queryOptions({
      input: { id: chatId },
      staleTime: 0,
    }),
  );
  const { isChatRunning } = useAgentSessionStatus({
    id: chatId,
    sessionId: undefined,
  });
  const wasRunning = useRef(isChatRunning);
  const { refetch } = query;
  useEffect(() => {
    if (wasRunning.current && !isChatRunning) {
      void refetch({ cancelRefetch: false });
    }
    wasRunning.current = isChatRunning;
  }, [isChatRunning, refetch]);
  return query;
}

/**
 * The footer's Undo changes button and the dialog that asks first: puts
 * back each file the reply changed as it was before the reply's turn. Shown
 * only for a reply Undo would change a file for. Each file goes back the
 * way a restore does, so its versions list keeps what this replaces.
 */
export function UndoReplyFiles({
  chatId,
  messageId,
}: {
  chatId: ChatId;
  messageId: StoreId.Message;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const undoable = useUndoableReplies(chatId);
  const reply = undoable.data?.find((each) => each.messageId === messageId);
  if (reply === undefined) {
    return null;
  }
  const { back, stay } = reply;
  const undo = async () => {
    setUndoing(true);
    const done = await rpcClient.workspace.chats.undoReplyFiles
      .call({ id: chatId, messageId })
      .catch((error: unknown) => {
        toast.error("Couldn’t undo those changes", { cause: error });
        return undefined;
      });
    setUndoing(false);
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: rpcClient.workspace.chats.fileVersions.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: rpcClient.workspace.chats.undoableReplies.key(),
      }),
    ]);
    if (!done) {
      return;
    }
    setOpen(false);
    toast(
      done.restored.length === 0
        ? "Those files already match how they were before this reply."
        : `Put back ${done.restored.join(", ")}`,
    );
  };
  const named = stay.slice(0, MOST_NAMED).join(", ");
  const more = stay.length - MOST_NAMED;
  return (
    <>
      <button
        className={cn(
          SHARED.messageFooterButton,
          "flex items-center gap-1 px-1.5 text-xs",
        )}
        onClick={() => {
          setOpen(true);
          void undoable.refetch({ cancelRefetch: false });
        }}
        type="button"
      >
        <ArrowCounterClockwiseIcon size={MESSAGE_FOOTER_ICON_SIZE} />
        Undo changes
      </button>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent maxWidth="28rem">
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this reply’s changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {back.length === 1
                ? "This file goes back to how it was before this reply. You can get the current version back from its versions list."
                : `These ${String(back.length)} files go back to how they were before this reply. You can get the current versions back from each file’s versions list.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogBody className="max-h-72">
            <ul className="space-y-2">
              {back.map(({ copy, file }) => (
                <li className="flex min-w-0 items-center gap-3" key={file}>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Thumb hostPath={file} version={undoable.dataUpdatedAt} />
                    <ArrowRightIcon className="size-3 text-muted-foreground" />
                    <Thumb hostPath={copy} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm">{nameOfPath(file)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {nameOfPath(file.slice(0, -nameOfPath(file).length - 1))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {stay.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {more > 0
                  ? `${named} and ${String(more)} more stay as they are.`
                  : `${named} ${stay.length === 1 ? "stays as it is" : "stay as they are"}.`}
              </p>
            )}
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={undoing}
              onClick={(event) => {
                // Closed once the files are back, so a failure leaves the
                // dialog up to try again.
                event.preventDefault();
                void undo();
              }}
            >
              Undo changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A file drawn small, or its type's mark where there is no picture of it. */
function Thumb({ hostPath, version }: { hostPath: string; version?: number }) {
  const { resolvedTheme } = useTheme();
  const src = getComputerThumbnailUrl({
    hostPath,
    size: 64,
    theme: resolvedTheme,
    version,
  });
  const [failed, setFailed] = useState<string>();
  return (
    <div className="flex size-10 items-center justify-center overflow-hidden rounded-md bg-muted ring-1 ring-border">
      {src && failed !== src ? (
        <img
          alt=""
          className="size-full object-contain"
          draggable={false}
          onError={() => {
            setFailed(src);
          }}
          src={src}
        />
      ) : (
        <FileMark
          className="size-5"
          hostPath={hostPath}
          name={nameOfPath(hostPath)}
        />
      )}
    </div>
  );
}
