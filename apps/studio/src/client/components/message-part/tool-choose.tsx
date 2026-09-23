import { rpcClient } from "@/client/rpc/client";
import {
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { getToolLabel } from "../../lib/tool-display";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  ToolCard,
  ToolCardEmpty,
  ToolCardHeader,
  ToolCardSection,
} from "./tool-card";
import { useHasLiveSession } from "./use-live-session";

export type ChooseOutput = Extract<
  ChoosePart,
  { state: "output-available" }
>["output"];

type ChoosePart = Extract<SessionMessagePart.ToolPart, { type: "tool-choose" }>;

/**
 * A question with its choices, drawn from nothing but what it asks and how it
 * was answered, so it can be drawn without a session behind it.
 *
 * While `open`, a choice answers with one click, the last row takes an answer
 * in the user's own words, a note can ride along with either, and Skip answers
 * that there is no answer. `ended` is a question nothing is listening to any
 * more; `closed` is one that was answered or failed.
 */
export function QuestionCard({
  choices,
  isSending = false,
  onAnswer,
  output,
  question,
  status,
}: {
  choices: string[];
  isSending?: boolean;
  onAnswer: (output: ChooseOutput) => void;
  output?: ChooseOutput;
  question: string;
  status: "closed" | "ended" | "open";
}) {
  const [ownAnswer, setOwnAnswer] = useState("");
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  const isOpen = status === "open";
  const selected =
    output && "selectedChoice" in output ? output.selectedChoice : undefined;
  // The answer is stored trimmed, so a choice written with stray spaces is
  // matched by its trimmed text.
  const isOwnAnswer =
    selected !== undefined &&
    !choices.some((choice) => choice.trim() === selected);

  const answer = (
    answered: { declined: true } | { selectedChoice: string },
  ) => {
    const trimmed = note.trim();
    onAnswer(trimmed ? { ...answered, note: trimmed } : answered);
  };
  const sendOwnAnswer = () => {
    const trimmed = ownAnswer.trim();
    if (trimmed) {
      answer({ selectedChoice: trimmed });
    }
  };

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">
          {getToolLabel("choose")}
        </p>
      </ToolCardHeader>

      {/* Clamped only once it is answered: a clamp over an open question can
          hide the row or the note someone is about to type into. */}
      <ToolCardSection collapsedHeight={isOpen ? 1024 : 256}>
        <p className="mb-3 text-sm">{question}</p>
        <div className="space-y-1.5" role={isOpen ? "radiogroup" : undefined}>
          {choices.map((choice, index) => {
            const isSelected = choice.trim() === selected;
            const row = <ChoiceRow isSelected={isSelected}>{choice}</ChoiceRow>;
            const className = rowClassName({ isOpen, isSelected });
            return isOpen ? (
              <button
                aria-checked={isSelected}
                className={className}
                disabled={isSending}
                key={index}
                onClick={() => {
                  answer({ selectedChoice: choice });
                }}
                role="radio"
                type="button"
              >
                {row}
              </button>
            ) : (
              <div className={className} key={index}>
                {row}
              </div>
            );
          })}
          {isOpen ? (
            // The answer none of the choices are, as one more row: typed into
            // rather than clicked, and sent with Return or the arrow.
            <div
              className={cn(
                rowClassName({ isOpen, isSelected: false }),
                "py-1.5 focus-within:border-foreground/30",
              )}
            >
              <ChoiceRow isSelected={false}>
                <input
                  aria-label="Your own answer"
                  className="w-full bg-transparent py-0.5 outline-none placeholder:text-muted-foreground"
                  disabled={isSending}
                  onChange={(event) => {
                    setOwnAnswer(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      sendOwnAnswer();
                    }
                  }}
                  placeholder="Something else…"
                  value={ownAnswer}
                />
              </ChoiceRow>
              <Button
                aria-label="Send your answer"
                className={cn("size-6", !ownAnswer.trim() && "invisible")}
                disabled={isSending || !ownAnswer.trim()}
                onClick={sendOwnAnswer}
                size="icon-sm"
                variant="brand"
              >
                <ArrowUpIcon weight="bold" />
              </Button>
            </div>
          ) : isOwnAnswer ? (
            <div className={rowClassName({ isOpen, isSelected: true })}>
              <ChoiceRow isSelected>{selected}</ChoiceRow>
            </div>
          ) : null}
        </div>

        {isOpen ? (
          <>
            {isNoteOpen ? (
              <Textarea
                aria-label="Note"
                autoFocus
                className="mt-2 min-h-12"
                disabled={isSending}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
                placeholder="A note to go with your answer"
                value={note}
              />
            ) : null}
            <div className="mt-2 flex items-center justify-between gap-2">
              {isNoteOpen ? (
                <span />
              ) : (
                <Button
                  disabled={isSending}
                  onClick={() => {
                    setIsNoteOpen(true);
                  }}
                  size="xs"
                  variant="ghost"
                >
                  Add a note
                </Button>
              )}
              <Button
                disabled={isSending}
                onClick={() => {
                  answer({ declined: true });
                }}
                size="xs"
                variant="ghost"
              >
                Skip
              </Button>
            </div>
          </>
        ) : (
          <>
            {output && "declined" in output ? (
              <p className="mt-3 text-xs text-muted-foreground">
                You skipped this question.
              </p>
            ) : null}
            {output?.note ? (
              <p className="mt-3 border-l-2 pl-2.5 text-xs whitespace-pre-wrap text-muted-foreground">
                {output.note}
              </p>
            ) : null}
            {status === "ended" ? (
              <p className="mt-3 text-xs text-muted-foreground">
                This question ended without an answer.
              </p>
            ) : null}
          </>
        )}
      </ToolCardSection>
    </ToolCard>
  );
}

export function ToolChoose({
  part,
  taskId,
}: {
  part: ChoosePart;
  taskId: TaskId;
}) {
  const answer = useMutation(
    rpcClient.workspace.session.answerToolCall.mutationOptions({
      onError: (error) => {
        toast.error("Could not send the answer", {
          description: error.message,
        });
      },
    }),
  );

  const isWaitedOn = useHasLiveSession(part.metadata.sessionId);

  if (!part.input) {
    return <ToolCardEmpty message="The question has not arrived yet." />;
  }

  // The call waits on the user until it has an output, and the card is how
  // they answer it -- for as long as anything is still listening for one.
  const isUnanswered = part.state === "input-available";
  // Typed for the input as it streams in, when any choice can be missing.
  const choices: (string | undefined)[] = part.input.choices ?? [];

  return (
    <QuestionCard
      choices={choices.filter((choice) => choice !== undefined)}
      isSending={answer.isPending}
      onAnswer={(output) => {
        answer.mutate({
          id: taskId,
          output,
          toolCallId: part.toolCallId,
          toolName: "choose",
        });
      }}
      output={part.state === "output-available" ? part.output : undefined}
      question={part.input.question ?? ""}
      status={isUnanswered ? (isWaitedOn ? "open" : "ended") : "closed"}
    />
  );
}

/**
 * A radio, so a choice reads as one thing to pick among several before it is
 * picked: a ring while open, the ring filled once chosen, and a check in the
 * ring where the answer stands.
 */
function ChoiceRow({
  children,
  isSelected,
}: {
  children: ReactNode;
  isSelected: boolean;
}) {
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full border",
          isSelected
            ? "border-brand-600 bg-brand-600 text-brand-foreground"
            : "border-border bg-background",
        )}
      >
        {isSelected && <CheckIcon className="size-2.5" weight="bold" />}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </>
  );
}

function rowClassName({
  isOpen,
  isSelected,
}: {
  isOpen: boolean;
  isSelected: boolean;
}) {
  return cn(
    "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm",
    isSelected
      ? "border-brand-600/40 bg-brand-500/8 text-foreground"
      : isOpen
        ? "border-border text-foreground hover:border-foreground/30 hover:bg-foreground/5"
        : "border-transparent text-muted-foreground",
  );
}
