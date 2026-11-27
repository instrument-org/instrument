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
import { browserTargetOf } from "@instrument-org/workspace/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { unique } from "radashi";
import { useRef, useState } from "react";

import { chatListOptions } from "./chat-list-query";
import { type Chat } from "./chats";
import {
  chatsStoppedByClose,
  chatsStoppedByPages,
  type StoppedByPage,
  type ClosingWhat,
  stopQuestionCopy,
} from "./close-stops";

/** The tabs agents are on now, by the chat. */
const inUseOptions = () =>
  rpcClient.workspace.browser.live.inUse.experimental_liveOptions();

/** A close waiting on the question: what it stops, and what each answer does. */
interface Asking {
  chats: Chat[];
  /** Those among them stopped by the close of the page their agent is on, rather than of a tab of their own. */
  byPage: StoppedByPage[];
  /** Each close asked for while the question was up, run in order on Stop and Close; each is handed the stops, settled. */
  closes: ((stopped: Promise<unknown>) => void)[];
  cancels: (() => void)[];
  what: ClosingWhat;
}

/**
 * Asks before a close that stops a chat, by a tab of its own
 * (`chatsStoppedByClose`) or the page its agent is on
 * (`chatsStoppedByPages`), and on
 * Stop and Close stops each chat as the composer's Stop does, then closes.
 * A close that stops nothing goes ahead at once. Closes asked for while the
 * question is up (Close Other Tabs closing tab by tab) join it, so one
 * question covers them all.
 */
export function useStopBeforeClosing() {
  const queryClient = useQueryClient();
  // Kept read while the window is up, so a close finds it as it stands.
  useQuery(inUseOptions());
  const asking = useRef<Asking>(undefined);
  // What the dialog shows, kept through its exit once answered.
  const [shown, setShown] = useState<Asking>();
  const [isOpen, setOpen] = useState(false);

  // Pages asked "Leave site?" one close at a time, as each comes up in turn.
  const leaving = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * Asks each page among the closing tabs that holds its close up "Leave
   * site?" first, as Chromium does (`askBeforeClosingPages`); Cancel there
   * keeps everything open. Then asks about the chats the close stops.
   */
  const ask = (
    tabs: readonly WindowTab[],
    what: ClosingWhat,
    close: (stopped: Promise<unknown>) => void,
    cancel?: () => void,
  ) => {
    const pages = tabs
      .filter((tab) => tab.kind === "page")
      .map((tab) => browserTargetOf(tab.id));
    if (pages.length === 0) {
      askToStop(tabs, what, close, cancel);
      return;
    }
    leaving.current = leaving.current.then(() =>
      rpcClient.browser.askBeforeClosingPages
        .call({ targetIds: pages })
        .catch(() => true)
        .then((isLeaving) => {
          if (isLeaving) {
            askToStop(tabs, what, close, cancel);
          } else {
            cancel?.();
          }
        }),
    );
  };

  const askToStop = (
    tabs: readonly WindowTab[],
    what: ClosingWhat,
    close: (stopped: Promise<unknown>) => void,
    cancel?: () => void,
  ) => {
    const listed = queryClient.getQueryData(chatListOptions().queryKey);
    const own = chatsStoppedByClose(tabs, listed);
    const byPage = chatsStoppedByPages(
      tabs,
      listed,
      queryClient.getQueryData(inUseOptions().queryKey),
    ).filter(({ chat }) => !own.some((each) => each.id === chat.id));
    const chats = [...own, ...byPage.map(({ chat }) => chat)];
    if (chats.length === 0) {
      close(Promise.resolve());
      return;
    }
    const before = asking.current;
    const next: Asking = before
      ? {
          // A chat whose own tab is closing too is stopped by that.
          byPage: unique(
            [...before.byPage, ...byPage],
            ({ chat }) => chat.id,
          ).filter(
            ({ chat }) =>
              before.byPage.some((each) => each.chat.id === chat.id) ||
              !before.chats.some((each) => each.id === chat.id),
          ),
          cancels: cancel ? [...before.cancels, cancel] : before.cancels,
          chats: unique([...before.chats, ...chats], (chat) => chat.id),
          closes: [...before.closes, close],
          what: before.what,
        }
      : {
          byPage,
          cancels: cancel ? [cancel] : [],
          chats,
          closes: [close],
          what,
        };
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
      answered.chats.map((chat) => {
        const closed = answered.byPage.find((each) => each.chat.id === chat.id);
        const stopping = closed
          ? rpcClient.workspace.session.stopOnClose.call({
              id: chat.id,
              page: closed.page,
              tab: closed.tab,
            })
          : rpcClient.workspace.session.stop.call({ id: chat.id });
        return stopping.catch((error: unknown) => {
          toast.error(`Couldn't stop “${chat.title}”`, { cause: error });
        });
      }),
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
      isUsingPage: shown.byPage.length > 0,
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
