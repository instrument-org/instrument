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

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { ToolCard, ToolCardEmpty, ToolCardSection } from "./tool-card";
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
 *
 * `sending` is an answer on its way: drawn as picked, with the rest of the card
 * held, so the click shows what it chose before the agent has it.
 */
export function QuestionCard({
  choices,
  onAnswer,
  output,
  question,
  sending,
  status,
}: {
  choices: string[];
  onAnswer: (output: ChooseOutput) => void;
  output?: ChooseOutput;
  question: string;
  sending?: ChooseOutput;
  status: "closed" | "ended" | "open";
}) {
  const [ownAnswer, setOwnAnswer] = useState("");
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  const isOpen = status === "open";
  const isSending = sending !== undefined;
  const shown = output ?? sending;
  const selected =
    shown && "selectedChoice" in shown ? shown.selectedChoice : undefined;
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
    // No header strip: the transcript row above the card already says it is
    // waiting, so the question leads, the way the folder and app cards lead
    // with what they ask.
    <ToolCard>
      {/* Clamped only once it is answered: a clamp over an open question can
          hide the row or the note someone is about to type into. */}
      <ToolCardSection collapsedHeight={isOpen ? 1024 : 256}>
        <p className="mb-2 text-sm font-medium text-pretty">{question}</p>
        {/* Pulled out by the rows' own padding, so the rings line up with the
            question while a highlighted row still has room around its text. */}
        <div
          className="-mx-2 flex flex-col gap-0.5"
          role={isOpen ? "radiogroup" : undefined}
        >
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
                rowClassName({ isOpen, isSelected: isOwnAnswer }),
                // A row's height with the send button in it rather than a
                // line of text, so it stands as tall as the rows above, and
                // the button sits 4px in from the row's top, right and bottom.
                "py-1 pr-1",
                !isOwnAnswer && "focus-within:bg-foreground/5",
                isSending && !isOwnAnswer && "opacity-50",
              )}
            >
              <ChoiceRow isSelected={isOwnAnswer}>
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
                  // The answer on its way rather than what was typed, so the
                  // row reads from the props like every other state of it.
                  value={isSending && isOwnAnswer ? selected : ownAnswer}
                />
              </ChoiceRow>
              {/* Inset in the row, so its corners are the row's less the 4px
                  between them: concentric with the highlight around it. */}
              <Button
                aria-label="Send your answer"
                className={cn(
                  "size-6 rounded-sm",
                  (isSending || !ownAnswer.trim()) && "invisible",
                )}
                disabled={isSending || !ownAnswer.trim()}
                onClick={sendOwnAnswer}
                size="icon-sm"
                variant="brand"
              >
                <ArrowUpIcon className="size-3.5" weight="bold" />
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
                className="mt-3 min-h-12"
                disabled={isSending}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
                placeholder="A note to go with your answer"
                value={note}
              />
            ) : null}
            {/* Pulled out by the buttons' padding, so their words line up with
                the question's edges rather than sitting indented under it. */}
            <div className="-mx-2.5 mt-2 flex items-center justify-between gap-2">
              {isNoteOpen ? (
                <span />
              ) : (
                <Button
                  className="text-muted-foreground"
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
                className="text-muted-foreground"
                disabled={isSending}
                onClick={() => {
                  answer({ declined: true });
                }}
                size="xs"
                variant="ghost"
              >
                {/* Says the note goes too, since skipping is the one answer
                    where a note would otherwise look like it was thrown away. */}
                {note.trim() ? "Skip with note" : "Skip"}
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
  // Held from the click until the output lands in the part, not just while the
  // call is pending: the call settles before the session's update brings the
  // output, and the card falling back to unpicked in between reads as the
  // click not taking. A failure clears it so the choices come back.
  const [sending, setSending] = useState<ChooseOutput>();

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
      onAnswer={(output) => {
        setSending(output);
        answer.mutate(
          {
            id: taskId,
            output,
            toolCallId: part.toolCallId,
            toolName: "choose",
          },
          {
            onError: () => {
              setSending(undefined);
            },
          },
        );
      }}
      output={part.state === "output-available" ? part.output : undefined}
      question={part.input.question ?? ""}
      sending={isUnanswered ? sending : undefined}
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
      {/* Hollow rather than filled with the page's background, which in dark
          mode is darker than the card and drew every ring as a black dot. */}
      <span
        aria-hidden
        className={cn(
          "grid size-4.5 shrink-0 place-items-center rounded-full border",
          isSelected
            ? "border-brand-600 bg-brand-600 text-brand-foreground"
            : "border-foreground/25 group-hover/choice:border-foreground/45",
        )}
      >
        {isSelected && <CheckIcon className="size-3" weight="bold" />}
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
  // Rows as a menu draws them, highlighted under the pointer rather than each
  // boxed in a border: the rings already say these are things to pick.
  return cn(
    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm",
    isSelected
      ? "bg-brand-500/10 text-foreground"
      : isOpen
        ? "group/choice text-foreground outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/60 disabled:opacity-50 disabled:hover:bg-transparent"
        : "text-muted-foreground",
  );
}
