import { GitBranchIcon } from "@phosphor-icons/react/GitBranch";
import { useState } from "react";

import {
  separatorDayLabel,
  separatorTimeLabel,
} from "@/client/lib/chat-separators";
import { toast } from "@/client/lib/toast";
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
 * The footer's Branch button and the dialog it opens, which quotes the reply
 * it is under from what the footer already has, so it reads nothing more.
 * `onBranch` makes the branch; the dialog closes once it has.
 */
export function BranchFromReply({
  at,
  onBranch,
  text,
}: {
  /** When the reply was written. */
  at: Date | undefined;
  onBranch: () => Promise<void>;
  /** The reply's words, as Copy copies them. */
  text: string;
}) {
  const [open, setOpen] = useState(false);
  // The day the quote is dated against, read as the dialog opens.
  const [openedAt, setOpenedAt] = useState(() => new Date());
  const [branching, setBranching] = useState(false);
  const branch = async () => {
    setBranching(true);
    try {
      await onBranch();
      setOpen(false);
    } catch (error) {
      toast.error("Couldn't branch the chat", { cause: error });
    }
    setBranching(false);
  };
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label="Branch from here"
            className={SHARED.messageFooterButton}
            onClick={() => {
              setOpenedAt(new Date());
              setOpen(true);
            }}
            type="button"
          >
            <GitBranchIcon size={MESSAGE_FOOTER_ICON_SIZE} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Branch from here</TooltipContent>
      </Tooltip>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Branch from this reply?</AlertDialogTitle>
            <AlertDialogDescription>
              Branching starts a new chat with the conversation up to this
              reply. This chat stays as it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {text !== "" && (
            <blockquote className="rounded-xl border-l-2 border-border bg-foreground/3 py-2.5 pr-3 pl-3.5 text-sm">
              <p className="line-clamp-3 text-foreground/80">{text}</p>
              {at && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {separatorDayLabel(at, openedAt)} {separatorTimeLabel(at)}
                </p>
              )}
            </blockquote>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={branching}
              onClick={(event) => {
                // Closed once the branch is made, so a failure leaves the
                // dialog up to try again.
                event.preventDefault();
                void branch();
              }}
              variant="brand"
            >
              Branch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
