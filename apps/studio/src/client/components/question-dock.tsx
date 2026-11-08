import { rpcClient } from "@/client/rpc/client";
import { toast } from "@/client/lib/toast";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { cn } from "../lib/utils";
import { QuestionCard } from "./message-part/tool-choose";

/**
 * The questions the chat's agent asked in its last turn, by the composer
 * once that turn is over, one card at a time in the order they were asked.
 * Each goes once it is answered or skipped, from any device, and the next
 * comes up; the chat hears all the answers together once the last is done.
 * Questions an earlier build asked carry no card here and stay under their
 * calls.
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
  const [first] = docked;
  if (first === undefined) {
    return null;
  }
  const waiting = docked.length - 1;
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
          key={first.id}
          onAnswer={(answered) => {
            setSent((all) => new Set(all).add(first.id));
            answer.mutate(
              { answer: answered, askId: first.id, id: chatId },
              {
                onError: (error) => {
                  setSent((all) => {
                    const left = new Set(all);
                    left.delete(first.id);
                    return left;
                  });
                  toast.error("Couldn't send your answer", { cause: error });
                },
              },
            );
          }}
          place={docked.length > 1 ? `1 of ${docked.length}` : undefined}
          questions={first.card}
          status="open"
        />
      </div>
      {first.away ? (
        <p className="relative mt-1.5 px-1 text-[13px] text-muted-foreground">
          {`You answered from ${first.away.by} while ${first.here ? "this computer" : first.computer} was away, so it’s asking again.`}
        </p>
      ) : null}
    </div>
  );
}
