import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import {
  getTrashTerminology,
  PROGRESS_MESSAGES,
} from "@/client/lib/trash-terminology";
import { TimerIcon } from "@phosphor-icons/react";
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
  content,
  description,
  items,
  onDelete,
  onExitComplete,
  onOpenChange,
  open,
  title,
}: DeleteWithProgressDialogProps<T>) {
  useBlockTabNavigation(open);
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
        onExitComplete={() => {
          onBodyExit();
          onExitComplete?.();
        }}
      >
        {bodyVisible && (
          <DeleteWithProgressDialogBody
            content={content}
            description={description}
            items={items}
            key={openKey}
            onDelete={onDelete}
            onOpenChange={onOpenChange}
            title={title}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteWithProgressDialogBody<T>({
  content,
  description,
  items,
  onDelete,
  onOpenChange,
  title,
}: Omit<DeleteWithProgressDialogProps<T>, "open">) {
  const trashTerminology = getTrashTerminology();
  const [isPending, setIsPending] = useState(false);
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
            <Spinner className="size-5" />
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
        <AlertDialogAction
          onClick={async (e) => {
            e.preventDefault();
            await handleDelete();
          }}
          variant="destructive"
        >
          Move to {trashTerminology}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
