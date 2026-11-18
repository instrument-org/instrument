import { rpcClient } from "@/client/rpc/client";
import { toast } from "@/client/lib/toast";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useIsActiveTab } from "../hooks/use-active-tab";
import { focusScreenHome } from "../lib/keyboard-home";
import { cn } from "../lib/utils";
import { QuestionCard } from "./message-part/tool-choose";

/** How long the last card takes to fold away once it is answered. */
const LEAVE_MS = 220;

/**
 * The questions the chat's agent asked in its last turn, by the composer
 * once that turn is over, one card at a time in the order they were asked.
 * Each goes once it is answered or skipped, from any device, and the next
 * comes up; the last folds away into the reply box, and the chat hears all
 * the answers together once it is done. Questions an earlier build asked
 * carry no card here and stay under their calls.
 */
export function QuestionDock({ chatId }: { chatId: ChatId }) {
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
  const isActiveTab = useIsActiveTab();
  const [first] = docked;
  // The card just answered, held as it was while it folds away, when no
  // other comes up in its place.
  const [shown, setShown] = useState(first);
  const [leaving, setLeaving] = useState<typeof first>(undefined);
  if (first?.id !== shown?.id) {
    setShown(first);
    setLeaving(first === undefined ? shown : undefined);
  }
  useEffect(() => {
    if (leaving === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      setLeaving(undefined);
    }, LEAVE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [leaving]);
  const card = first ?? leaving;
  const isLeaving = first === undefined;
  // The keyboard in the card as it folds away, put there by a digit or Tab,
  // goes home to the reply box, rather than onto nothing as the card goes
  // inert.
  const dockRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const focused = document.activeElement;
    if (
      isLeaving &&
      focused instanceof HTMLElement &&
      dockRef.current?.contains(focused)
    ) {
      focused.blur();
      focusScreenHome({ leaving: false });
    }
  }, [isLeaving]);
  if (card === undefined) {
    return null;
  }
  const waiting = Math.max(0, docked.length - 1);
  return (
    // Folds from its own height to none, so the reply box comes down to
    // where the card was rather than jumping there.
    <div
      className={cn(
        "grid grid-rows-[1fr] transition-[grid-template-rows,opacity] ease-out motion-reduce:transition-none",
        isLeaving && "grid-rows-[0fr] opacity-0",
      )}
      inert={isLeaving}
      ref={dockRef}
      style={{ transitionDuration: `${String(LEAVE_MS)}ms` }}
    >
      <div className={cn("min-h-0", isLeaving && "overflow-hidden")}>
        <div className={cn("relative mb-2", waiting > 0 && "pb-2")}>
          {waiting > 1 ? (
            <div className="absolute inset-x-6 bottom-0 h-6 rounded-b-2xl border border-border bg-card/70" />
          ) : null}
          {waiting > 0 ? (
            <div className="absolute inset-x-3 bottom-1 h-6 rounded-b-2xl border border-border bg-card shadow-xs" />
          ) : null}
          {/* Rises in the way a message arrives in the chat above it. */}
          <div className="relative animate-in duration-200 ease-out fade-in-0 fill-mode-both slide-in-from-bottom-2 *:mt-0 *:shadow-xs motion-reduce:animate-none">
            <QuestionCard
              key={card.id}
              onAnswer={(answered) => {
                setSent((all) => new Set(all).add(card.id));
                answer.mutate(
                  { answer: answered, askId: card.id, id: chatId },
                  {
                    onError: (error) => {
                      setSent((all) => {
                        const left = new Set(all);
                        left.delete(card.id);
                        return left;
                      });
                      toast.error("Couldn't send your answer", {
                        cause: error,
                      });
                    },
                  },
                );
              }}
              place={docked.length > 1 ? `1 of ${docked.length}` : undefined}
              questions={card.card}
              status="open"
              takesKeys={isActiveTab && !isLeaving}
            />
          </div>
          {card.away ? (
            <p className="relative mt-1.5 px-1 text-[13px] text-muted-foreground">
              {`You answered from ${card.away.by} while ${card.here ? "this computer" : card.computer} was away, so it’s asking again.`}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
