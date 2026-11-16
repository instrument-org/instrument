import { rpcClient } from "@/client/rpc/client";
import { toast } from "@/client/lib/toast";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type Ref,
  type RefObject,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn } from "../lib/utils";
import { focusQuestionCard, QuestionCard } from "./message-part/tool-choose";

/**
 * The questions the chat's agent asked in its last turn, by the composer
 * once that turn is over, one card at a time in the order they were asked.
 * Each goes once it is answered or skipped, from any device, and the next
 * comes up; the chat hears all the answers together once the last is done.
 * Questions an earlier build asked carry no card here and stay under their
 * calls.
 */
export function useQuestionDock(chatId: ChatId) {
  const asks = useQuery(
    rpcClient.workspace.chats.live.asks.experimental_liveOptions({
      input: { id: chatId },
    }),
  ).data;
  // Answers sent from here that the chat's asks don't show yet, so the next
  // card comes up on the click. One given while the computer that asked was
  // away comes back asking again, and shows.
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const answer = useMutation(
    rpcClient.workspace.chats.answerQuestion.mutationOptions(),
  );
  const docked = (asks ?? []).flatMap((ask) =>
    ask.kind === "question" &&
    ask.card !== undefined &&
    ask.answerable &&
    (ask.away !== undefined || !sent.has(ask.id))
      ? [{ ...ask, card: ask.card }]
      : [],
  );
  const [first] = docked;
  return {
    count: docked.length,
    first,
    send: (
      askId: string,
      answered: Parameters<Parameters<typeof QuestionCard>[0]["onAnswer"]>[0],
    ) => {
      setSent((all) => new Set(all).add(askId));
      answer.mutate(
        { answer: answered, askId, id: chatId },
        {
          onError: (error) => {
            setSent((all) => {
              const left = new Set(all);
              left.delete(askId);
              return left;
            });
            toast.error("Couldn't send your answer", { cause: error });
          },
        },
      );
    },
  };
}

type QuestionDockState = ReturnType<typeof useQuestionDock>;

/**
 * The card of the dock's first question, the others stacked under it. With
 * `onChatAbout` it offers writing back in the chat instead, and `collapsed`
 * folds it to one row with `onBack` to open it again.
 */
export function QuestionDock({
  collapsed = false,
  dock,
  onBack,
  onChatAbout,
  ref,
}: {
  collapsed?: boolean;
  dock: QuestionDockState;
  onBack?: () => void;
  onChatAbout?: () => void;
  ref?: Ref<HTMLDivElement>;
}) {
  const { count, first, send } = dock;
  if (first === undefined) {
    return null;
  }
  const waiting = count - 1;
  return (
    <div className={cn("relative mb-2", waiting > 0 && "pb-2")} ref={ref}>
      {waiting > 1 ? (
        <div className="absolute inset-x-6 bottom-0 h-6 rounded-b-2xl border border-border bg-card/70" />
      ) : null}
      {waiting > 0 ? (
        <div className="absolute inset-x-3 bottom-1 h-6 rounded-b-2xl border border-border bg-card shadow-xs" />
      ) : null}
      {/* Rises in the way a message arrives in the chat above it. */}
      <div className="relative animate-in duration-200 ease-out fade-in-0 fill-mode-both slide-in-from-bottom-2 *:mt-0 *:shadow-xs motion-reduce:animate-none">
        <QuestionCard
          collapsed={collapsed}
          key={first.id}
          onAnswer={(answered) => {
            send(first.id, answered);
          }}
          onBack={onBack}
          onChatAbout={onChatAbout}
          place={count > 1 ? `1 of ${count}` : undefined}
          questions={first.card}
          status="open"
        />
      </div>
      {first.away && !collapsed ? (
        <p className="relative mt-1.5 px-1 text-[13px] text-muted-foreground">
          {`You answered from ${first.away.by} while ${first.here ? "this computer" : first.computer} was away, so it’s asking again.`}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Whether the dock's card stands in the reply box's place, and where the
 * keyboard goes as they trade places.
 *
 * The box gives way to a card while it is empty (no words, nothing attached,
 * nobody dictating), and stays for a card that arrives while it has
 * something in it, or that gets something while it is away (a dictation or
 * a file dropped on the chat). Chat about this brings it back beside the
 * card folded to one row, until Back to question.
 *
 * The keyboard goes to the card's first choice as the box gives way, if it
 * was in the composer or on nothing, and to the box as the card goes or is
 * folded away; never from anywhere else, so a card answered on another
 * device leaves a person's place in the chat list alone.
 */
export function useQuestionBox({
  askId,
  composerRef,
  dockRef,
  focusBox,
  isActive,
  isBoxEmpty,
}: {
  /** The dock's first question, while one is up. */
  askId: string | undefined;
  /** The column the dock and the box are drawn in. */
  composerRef: RefObject<HTMLElement | null>;
  /** The dock, drawn with this as its `ref`. */
  dockRef: RefObject<HTMLElement | null>;
  focusBox: () => void;
  /** Whether the chat is on show, so a card arriving in a tab out of sight takes no keyboard. */
  isActive: boolean;
  isBoxEmpty: boolean;
}) {
  // By the question each is for, so the next question starts over.
  const [chatAboutFor, setChatAboutFor] = useState<string>();
  const [keptFor, setKeptFor] = useState<string>();
  const isCollapsed = askId !== undefined && chatAboutFor === askId;
  const wouldHide = askId !== undefined && !isCollapsed && keptFor !== askId;
  if (wouldHide && !isBoxEmpty) {
    setKeptFor(askId);
  }
  const isBoxHidden = wouldHide && isBoxEmpty;

  const focusCard = () => {
    const dock = dockRef.current;
    return dock !== null && focusQuestionCard(dock);
  };
  // Set by a press that says where the keyboard goes, over the rule below.
  const sendKeyboard = useRef<"box" | "card" | "stay" | undefined>(undefined);
  const shown = useRef({ askId, isBoxHidden });
  const settleKeyboard = useEffectEvent(() => {
    const was = shown.current;
    shown.current = { askId, isBoxHidden };
    const asked = sendKeyboard.current;
    sendKeyboard.current = undefined;
    if (!isActive || asked === "stay") {
      return;
    }
    if (asked === "card") {
      focusCard();
      return;
    }
    if (asked === "box") {
      focusBox();
      return;
    }
    if (was.isBoxHidden === isBoxHidden && was.askId === askId) {
      return;
    }
    // A card answered or folded away takes the keyboard with it, which
    // leaves it on nothing.
    const focused = document.activeElement;
    const isOnNothing = focused === null || focused === document.body;
    if (isBoxHidden) {
      if (isOnNothing || composerRef.current?.contains(focused) === true) {
        focusCard();
      }
    } else if (isOnNothing) {
      focusBox();
    }
  });
  useLayoutEffect(() => {
    settleKeyboard();
  }, [askId, isBoxHidden, isCollapsed]);

  return {
    /** Where a request to focus the box lands while the card stands in its place. */
    focus: () => {
      if (!isBoxHidden || !focusCard()) {
        focusBox();
      }
    },
    isBoxHidden,
    isCollapsed,
    /** Keeps the box beside the card, for something put in it from outside. */
    keepBox: () => {
      if (askId !== undefined && isBoxHidden) {
        sendKeyboard.current = "box";
        setKeptFor(askId);
      }
    },
    onBack: () => {
      sendKeyboard.current = "card";
      setChatAboutFor(undefined);
      setKeptFor(undefined);
    },
    onChatAbout: () => {
      sendKeyboard.current = "box";
      setChatAboutFor(askId);
    },
    /** Folds the card beside the box as Chat about this does, leaving the keyboard to what asked, such as the model picker. */
    showBox: () => {
      if (askId !== undefined && isBoxHidden) {
        sendKeyboard.current = "stay";
        setChatAboutFor(askId);
      }
    },
  };
}
