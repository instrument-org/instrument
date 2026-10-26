import { useModalBack } from "@/client/hooks/use-modal-back";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import { PROGRESS_MESSAGES } from "@/client/lib/trash-terminology";
import { osConventions } from "@/client/lib/utils";
import { TimerIcon } from "@phosphor-icons/react/Timer";
import { type ReactNode, useEffect, useState } from "react";

import { Alert, AlertDescription } from "./ui/alert";
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
import { Spinner } from "./ui/spinner";

interface DeleteWithProgressDialogProps<T> {
  /** The delete button's label, Move to Trash unless given. */
  actionLabel?: string;
  /** A second way out beside Cancel, which closes the dialog and runs. */
  alternative?: { label: string; onSelect: () => void };
  content?: ReactNode;
  description: string;
  items: T[];
  onDelete: (items: T[]) => Promise<void>;
  onExitComplete?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}

export function DeleteWithProgressDialog<T>({
  actionLabel,
  alternative,
  content,
  description,
  items,
  onDelete,
  onExitComplete,
  onOpenChange,
  open,
  title,
}: DeleteWithProgressDialogProps<T>) {
  const [isPending, setIsPending] = useState(false);
  // Keep the body mounted through the close animation instead of unmounting it
  // the instant `open` flips false, which would animate out an empty frame.
  // Cleared when AlertDialogContent's exit animation actually ends.
  const {
    content: bodyVisible,
    onExitComplete: onBodyExit,
    openKey,
  } = useDeferredModalState(open ? true : null);

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onExitComplete={() => {
          setIsPending(false);
          onBodyExit();
          onExitComplete?.();
        }}
      >
        {bodyVisible && (
          <DeleteWithProgressDialogBody
            actionLabel={actionLabel}
            alternative={alternative}
            content={content}
            description={description}
            items={items}
            isPending={isPending}
            setIsPending={setIsPending}
            key={openKey}
            onDelete={onDelete}
            onOpenChange={onOpenChange}
            open={open}
            title={title}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteWithProgressDialogBody<T>({
  actionLabel,
  alternative,
  content,
  description,
  items,
  isPending,
  setIsPending,
  onDelete,
  onOpenChange,
  open,
  title,
}: DeleteWithProgressDialogProps<T> & {
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
}) {
  const trashTerminology = osConventions().trash;
  // Held for as long as it is open; it can be left only while nothing is
  // being deleted.
  useModalBack(() => {
    onOpenChange(false);
  }, open && !isPending);
  const [showWarning, setShowWarning] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (!isPending) {
      return;
    }

    const initialTimer = setTimeout(() => {
      setShowWarning(true);
    }, 3000);

    const cycleTimer = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % PROGRESS_MESSAGES.length);
    }, 7000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(cycleTimer);
    };
  }, [isPending]);

  const handleDelete = async () => {
    setIsPending(true);
    try {
      await onDelete(items);
      onOpenChange(false);
    } catch {
      setIsPending(false);
    }
  };

  if (isPending) {
    return (
      <>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Spinner className="size-5" delay={0} />
            Moving to {trashTerminology}
          </AlertDialogTitle>
          <AlertDialogDescription>
            This may take a moment...
          </AlertDialogDescription>
        </AlertDialogHeader>
        {showWarning && (
          <Alert variant="default">
            <TimerIcon />
            <AlertDescription>
              {PROGRESS_MESSAGES[messageIndex]}
            </AlertDescription>
          </Alert>
        )}
      </>
    );
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        {content}
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        {alternative && (
          <AlertDialogCancel
            onClick={() => {
              alternative.onSelect();
            }}
          >
            {alternative.label}
          </AlertDialogCancel>
        )}
        <AlertDialogAction
          onClick={async (e) => {
            e.preventDefault();
            await handleDelete();
          }}
          variant="destructive"
        >
          {actionLabel ?? `Move to ${trashTerminology}`}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
