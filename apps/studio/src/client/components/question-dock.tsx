import { rpcClient } from "@/client/rpc/client";
import { toast } from "@/client/lib/toast";
import {
  type ChatId,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { cn } from "../lib/utils";
import { ComposerDock } from "./composer-dock";
import { type ChooseOutput, QuestionCard } from "./message-part/tool-choose";

/**
 * The questions the chat's agent asked in its last turn that wait by the
 * composer once that turn is over, in the order they were asked, with the way
 * to answer one. Each goes once it is answered or skipped, from any device,
 * and the next comes up. Questions an earlier build asked carry no card here
 * and stay under their calls.
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
  const { mutate: sendAnswer } = useMutation(
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
  const send = (askId: string, answered: ChooseOutput) => {
    setSent((all) => new Set(all).add(askId));
    sendAnswer(
      { answer: answered, askId, id: chatId },
      {
        onError: (error) => {
          setSent((all) => {
            const left = new Set(all);
            left.delete(askId);
            return left;
          });
          toast.error("Couldn't send your answer", {
            cause: error,
          });
        },
      },
    );
  };
  // Which question the card on show has up, by its index, as the card last
  // said: read when a reply is sent, never drawn.
  const shown = useRef<{ askId: string; at: number }>(undefined);
  const setShown = (askId: string, at: number) => {
    shown.current = { askId, at };
  };
  /**
   * The question up on the card on show, for a reply sent from the box
   * under it to carry, so a bare "2" reads against it. None while no card
   * is up.
   */
  const questionOnScreen = ():
    | SessionMessageDataPart.ViewContextDataPart["question"]
    | undefined => {
    const [first] = docked;
    if (first === undefined) {
      return undefined;
    }
    const at = shown.current?.askId === first.id ? shown.current.at : 0;
    const question = first.card[at];
    return question === undefined
      ? undefined
      : {
          at: at + 1,
          choices: question.choices.map((choice) => choice.label),
          of: first.card.length,
          text: question.question,
        };
  };
  return { docked, questionOnScreen, send, setShown };
}

/**
 * The chat's questions by the composer (`useQuestionDock`), one card at a
 * time; the last folds away into the reply box, and the chat hears all the
 * answers together once it is done.
 */
export function QuestionDock({
  dock: { docked, send, setShown },
}: {
  dock: ReturnType<typeof useQuestionDock>;
}) {
  return (
    <ComposerDock first={docked[0]}>
      {(card) => {
        const waiting = Math.max(0, docked.length - 1);
        return (
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
                  send(card.id, answered);
                }}
                onShown={(at) => {
                  setShown(card.id, at);
                }}
                place={docked.length > 1 ? `1 of ${docked.length}` : undefined}
                questions={card.card}
                status="open"
              />
            </div>
            {card.away ? (
              <p className="relative mt-1.5 px-1 text-[13px] text-muted-foreground">
                {`${card.here ? "This computer" : card.computer} wasn’t available when you answered on ${card.away.by}. Please answer again.`}
              </p>
            ) : null}
          </div>
        );
      }}
    </ComposerDock>
  );
}
