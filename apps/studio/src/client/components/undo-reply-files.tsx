import {
  type ChatId,
  nameOfPath,
  type StoreId,
} from "@instrument-org/workspace/client";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { MESSAGE_FOOTER_ICON_SIZE, SHARED } from "../lib/styles";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * The footer's Undo changes button and the dialog that asks first: puts
 * back every file the reply handed over as it was before the reply's turn.
 * Each file goes back the way a restore does, so its versions list keeps
 * what this replaces.
 */
export function UndoReplyFiles({
  chatId,
  files,
  messageId,
}: {
  chatId: ChatId;
  /** The paths the reply's files fence wrote. */
  files: readonly string[];
  messageId: StoreId.Message;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const names = files.map(nameOfPath);
  const undo = async () => {
    setUndoing(true);
    try {
      const { left, restored } =
        await rpcClient.workspace.chats.undoReplyFiles.call({
          id: chatId,
          messageId,
        });
      await queryClient.invalidateQueries({
        queryKey: rpcClient.workspace.chats.fileVersions.key(),
      });
      setOpen(false);
      toast(
        restored.length === 0
          ? "Nothing to put back. These files didn’t exist before this reply."
          : `Put back ${restored.join(", ")}`,
        left.length > 0 && restored.length > 0
          ? { description: `${left.join(", ")} stayed as it is.` }
          : {},
      );
    } catch (error) {
      toast.error("Couldn’t undo those changes", { cause: error });
    }
    setUndoing(false);
  };
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label="Undo changes"
            className={SHARED.messageFooterButton}
            onClick={() => {
              setOpen(true);
            }}
            type="button"
          >
            <ArrowCounterClockwiseIcon size={MESSAGE_FOOTER_ICON_SIZE} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Undo changes</TooltipContent>
      </Tooltip>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this reply’s changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This puts {names.length === 1 ? "this file" : "these files"} back
              the way {names.length === 1 ? "it was" : "they were"} before this
              reply. What’s there now stays in{" "}
              {names.length === 1 ? "its" : "each file’s"} versions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-1 text-sm">
            {names.map((name) => (
              <li className="truncate" key={name}>
                {name}
              </li>
            ))}
          </ul>
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
