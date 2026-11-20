import { type WindowTab } from "@/client/atoms/window";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { unique } from "radashi";
import { useRef, useState } from "react";

import { chatListOptions } from "./chat-list-query";
import { type Chat } from "./chats";
import {
  chatsStoppedByClose,
  type ClosingWhat,
  stopQuestionCopy,
} from "./close-stops";

/** A close waiting on the question: what it stops, and what each answer does. */
interface Asking {
  chats: Chat[];
  /** Each close asked for while the question was up, run in order on Stop and Close; each is handed the stops, settled. */
  closes: ((stopped: Promise<unknown>) => void)[];
  cancels: (() => void)[];
  what: ClosingWhat;
}

/**
 * Asks before a close that stops a chat (`chatsStoppedByClose`), and on
 * Stop and Close stops each chat as the composer's Stop does, then closes.
 * A close that stops nothing goes ahead at once. Closes asked for while the
 * question is up (Close Other Tabs closing tab by tab) join it, so one
 * question covers them all.
 */
export function useStopBeforeClosing() {
  const queryClient = useQueryClient();
  const asking = useRef<Asking>(undefined);
  // What the dialog shows, kept through its exit once answered.
  const [shown, setShown] = useState<Asking>();
  const [isOpen, setOpen] = useState(false);

  const ask = (
    tabs: readonly WindowTab[],
    what: ClosingWhat,
    close: (stopped: Promise<unknown>) => void,
    cancel?: () => void,
  ) => {
    const chats = chatsStoppedByClose(
      tabs,
      queryClient.getQueryData(chatListOptions().queryKey),
    );
    if (chats.length === 0) {
      close(Promise.resolve());
      return;
    }
    const before = asking.current;
    const next: Asking = before
      ? {
          cancels: cancel ? [...before.cancels, cancel] : before.cancels,
          chats: unique([...before.chats, ...chats], (chat) => chat.id),
          closes: [...before.closes, close],
          what: before.what,
        }
      : { cancels: cancel ? [cancel] : [], chats, closes: [close], what };
    asking.current = next;
    setShown(next);
    setOpen(true);
  };

  const settle = (isStopping: boolean) => {
    const answered = asking.current;
    asking.current = undefined;
    setOpen(false);
    if (!answered) {
      return;
    }
    if (!isStopping) {
      for (const cancel of answered.cancels) {
        cancel();
      }
      return;
    }
    const stopped = Promise.allSettled(
      answered.chats.map((chat) =>
        rpcClient.workspace.session.stop
          .call({ id: chat.id })
          .catch((error: unknown) => {
            toast.error(`Couldn't stop “${chat.title}”`, { cause: error });
          }),
      ),
    );
    for (const close of answered.closes) {
      close(stopped);
    }
  };

  const copy =
    shown &&
    stopQuestionCopy({
      chats: shown.chats,
      closes: shown.closes.length,
      what: shown.what,
    });
  const dialog = (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          settle(false);
        }
      }}
      open={isOpen}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              settle(true);
            }}
            variant="destructive"
          >
            Stop and Close
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  /**
   * Whether the window may close, asked when the person closes it: true at
   * once when no chat in it works, else once Stop and Close has stopped them.
   */
  const askForWindow = (tabs: readonly WindowTab[]) =>
    new Promise<boolean>((resolve) => {
      ask(
        tabs,
        "window",
        (stopped) => {
          void stopped.then(() => {
            resolve(true);
          });
        },
        () => {
          resolve(false);
        },
      );
    });

  return { ask, askForWindow, dialog };
}
