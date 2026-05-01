import { Button } from "@/client/components/ui/button";
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
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}

export function DeleteWithProgressDialog<T>({
  content,
  description,
  items,
  onDelete,
  onOpenChange,
  open,
  title,
}: DeleteWithProgressDialogProps<T>) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        {open && (
          <DeleteWithProgressDialogBody
            content={content}
            description={description}
            items={items}
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
        <AlertDialogAction asChild className="text-white">
          <Button
            onClick={async (e) => {
              e.preventDefault();
              await handleDelete();
            }}
            variant="destructive"
          >
            Move to {trashTerminology}
          </Button>
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
