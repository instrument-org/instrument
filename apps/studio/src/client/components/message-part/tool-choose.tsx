import { rpcClient } from "@/client/rpc/client";
import {
  type ChatId,
  chooseAnswer,
  type ChooseQuestion,
  chooseQuestions,
  type SessionMessageDataPart,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { MinusIcon } from "@phosphor-icons/react/Minus";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { toast } from "@/client/lib/toast";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { DictatedTextarea, useDictatedText } from "../dictation-controls";
import { isDictating } from "@/client/hooks/use-dictation";
import { ToolCard, ToolCardEmpty } from "./tool-card";

/** The answer to a card: a reply to each of its questions, and a note. */
export type ChooseOutput = SessionMessageDataPart.QuestionCardAnswer;

type ChoosePart = Extract<SessionMessagePart.ToolPart, { type: "tool-choose" }>;

/** Where the person is with one question before they send the card. */
interface Draft {
  /** What they typed into the row for their own answer. */
  own: string;
  /** The labels of the choices they picked. */
  picked: string[];
  skipped: boolean;
}

const EMPTY_DRAFT: Draft = { own: "", picked: [], skipped: false };

function replyOf(draft: Draft): SessionMessageDataPart.QuestionReply {
  const own = draft.own.trim();
  const picked = own ? [...draft.picked, own] : draft.picked;
  return draft.skipped || picked.length === 0 ? { skipped: true } : { picked };
}

function hasReply(draft: Draft) {
  return !draft.skipped && (draft.picked.length > 0 || draft.own.trim() !== "");
}

/**
 * A card of one to four questions, drawn from nothing but what it asks and
 * how it was answered, so it can be drawn without a session behind it.
 *
 * While `open`, a click only picks: the answer goes when the person presses
 * Send, so a misclick can be put right and a note written after picking. A
 * card of several questions shows them one at a time under a row of their
 * headers, a pick moving on to the next, and ends on a review of every
 * answer with one Send for them all. `ended` is a card nothing is listening
 * to any more; `closed` is one that was answered or failed. Anything but
 * open draws as one line per question with its answer, which opens to show
 * what else was offered.
 *
 * `sending` is an answer on its way, drawn as given before the agent has it.
 */
export function QuestionCard({
  onAnswer,
  output,
  questions,
  sending,
  status,
}: {
  onAnswer: (output: ChooseOutput) => void;
  output?: ChooseOutput;
  questions: ChooseQuestion[];
  sending?: ChooseOutput;
  status: "closed" | "ended" | "open";
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [step, setStep] = useState(0);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  const isOpen = status === "open" && sending === undefined;
  const noteDictation = useDictatedText({
    onChange: setNote,
    surface: "question-note",
    value: note,
  });
  // The note's box goes once the card stops being open, so a take still
  // recording into it is thrown away rather than left on with no controls.
  const cancelNoteDictation = useEffectEvent(() => {
    noteDictation.cancel();
  });
  useEffect(() => {
    if (!isOpen) {
      cancelNoteDictation();
    }
  }, [isOpen]);

  if (!isOpen) {
    return (
      <AnsweredCard
        answer={output ?? sending}
        ended={status === "ended"}
        questions={questions}
      />
    );
  }

  // Answering waits for dictated words, so the note goes with them.
  const isHolding = isDictating(noteDictation.phase);
  const isSeveral = questions.length > 1;
  const isReview = isSeveral && step >= questions.length;
  const draftAt = (index: number) => drafts[index] ?? EMPTY_DRAFT;
  const current = draftAt(step);
  const question = questions[step];

  const send = (replies: SessionMessageDataPart.QuestionReply[]) => {
    if (isHolding) {
      return;
    }
    const trimmed = note.trim();
    onAnswer(trimmed ? { note: trimmed, replies } : { replies });
  };
  const sendDrafts = () => {
    send(questions.map((_, index) => replyOf(draftAt(index))));
  };
  const skipAll = () => {
    send(questions.map(() => ({ skipped: true })));
  };
  const setDraft = (index: number, change: (draft: Draft) => Draft) => {
    setDrafts((all) =>
      questions.map((_, each) =>
        each === index
          ? change(all[each] ?? EMPTY_DRAFT)
          : (all[each] ?? EMPTY_DRAFT),
      ),
    );
  };
  const next = () => {
    setStep((at) => Math.min(at + 1, questions.length));
  };

  const pick = (label: string) => {
    if (question?.multiSelect) {
      setDraft(step, (draft) => ({
        ...draft,
        picked: draft.picked.includes(label)
          ? draft.picked.filter((each) => each !== label)
          : [...draft.picked, label],
        skipped: false,
      }));
      return;
    }
    setDraft(step, () => ({ own: "", picked: [label], skipped: false }));
    // One pick answers a question of one choice, so the card moves on.
    if (isSeveral) {
      next();
    }
  };
  const typeOwn = (own: string) => {
    setDraft(step, (draft) => ({
      own,
      // Their own words are the answer to a question of one choice, so a
      // choice picked before goes.
      picked: question?.multiSelect || own.trim() === "" ? draft.picked : [],
      skipped: false,
    }));
  };
  const submitOwn = () => {
    if (!hasReply(current)) {
      return;
    }
    if (isSeveral) {
      next();
    } else {
      sendDrafts();
    }
  };

  const noteBox = (
    <DictatedTextarea
      aria-label="Note"
      autoFocus={!isReview}
      className="mt-3 min-h-12"
      dictation={noteDictation}
      onChange={(event) => {
        setNote(event.target.value);
      }}
      placeholder="A note to go with your answers"
      value={note}
    />
  );

  return (
    <ToolCard>
      <div className="px-4 py-3">
        {isSeveral ? (
          <Steps
            drafts={questions.map((_, index) => draftAt(index))}
            onStep={setStep}
            questions={questions}
            step={step}
          />
        ) : null}

        {isReview ? (
          <>
            <dl className="flex flex-col gap-1.5 text-sm">
              {questions.map((each, index) => {
                const reply = replyOf(draftAt(index));
                return (
                  <div className="flex items-baseline gap-3" key={index}>
                    <dt className="w-28 shrink-0 truncate text-xs text-muted-foreground">
                      {each.header || each.question}
                    </dt>
                    <dd
                      className={cn(
                        "min-w-0",
                        "skipped" in reply && "text-muted-foreground",
                      )}
                    >
                      {"skipped" in reply ? "Skipped" : reply.picked.join(", ")}
                    </dd>
                  </div>
                );
              })}
            </dl>
            {noteBox}
          </>
        ) : question ? (
          <QuestionStep
            draft={current}
            key={step}
            onOwn={typeOwn}
            onPick={pick}
            onSubmitOwn={submitOwn}
            question={question}
          />
        ) : null}

        {!isSeveral && isNoteOpen ? noteBox : null}

        {/* Pulled out by the buttons' padding, so their words line up with
            the question's edges rather than sitting indented under it. */}
        <div className="-mx-2.5 mt-2 flex items-center justify-between gap-2">
          {isSeveral || isNoteOpen ? (
            <span />
          ) : (
            <Button
              className="text-muted-foreground"
              onClick={() => {
                setIsNoteOpen(true);
              }}
              size="xs"
              variant="ghost"
            >
              Add a note
            </Button>
          )}
          <span className="flex items-center gap-1">
            {isReview ? (
              <>
                <Button
                  className="text-muted-foreground"
                  disabled={isHolding}
                  onClick={skipAll}
                  size="xs"
                  variant="ghost"
                >
                  Skip all
                </Button>
                <SendButton disabled={isHolding} onClick={sendDrafts}>
                  Send answers
                </SendButton>
              </>
            ) : isSeveral ? (
              <>
                <Button
                  className="text-muted-foreground"
                  onClick={() => {
                    setDraft(step, () => ({ ...EMPTY_DRAFT, skipped: true }));
                    next();
                  }}
                  size="xs"
                  variant="ghost"
                >
                  Skip
                </Button>
                <SendButton
                  disabled={!hasReply(current)}
                  icon="next"
                  onClick={next}
                >
                  Next
                </SendButton>
              </>
            ) : (
              <>
                <Button
                  className="text-muted-foreground"
                  disabled={isHolding}
                  onClick={skipAll}
                  size="xs"
                  variant="ghost"
                >
                  {/* Says the note goes too, since skipping is the one answer
                      where a note would otherwise look like it was thrown away. */}
                  {note.trim() ? "Skip with note" : "Skip"}
                </Button>
                <SendButton
                  disabled={isHolding || !hasReply(current)}
                  onClick={sendDrafts}
                >
                  Send
                </SendButton>
              </>
            )}
          </span>
        </div>
      </div>
    </ToolCard>
  );
}

/** One question while the card is open: its choices and a row for the person's own words. */
function QuestionStep({
  draft,
  onOwn,
  onPick,
  onSubmitOwn,
  question,
}: {
  draft: Draft;
  onOwn: (own: string) => void;
  onPick: (label: string) => void;
  onSubmitOwn: () => void;
  question: ChooseQuestion;
}) {
  const isMulti = question.multiSelect === true;
  const hasOwn = draft.own.trim() !== "";
  return (
    <>
      <p className="mb-2 text-sm font-medium text-pretty">
        {question.question}
      </p>
      {/* Pulled out by the rows' own padding, so the marks line up with the
          question while a highlighted row still has room around its text. */}
      <div
        className="-mx-2 flex flex-col gap-0.5"
        role={isMulti ? "group" : "radiogroup"}
      >
        {question.choices.map((choice, index) => {
          const isSelected = draft.picked.includes(choice.label);
          return (
            <button
              aria-checked={isSelected}
              className={rowClassName(isSelected)}
              key={index}
              onClick={() => {
                onPick(choice.label);
              }}
              role={isMulti ? "checkbox" : "radio"}
              type="button"
            >
              <ChoiceRow isMulti={isMulti} isSelected={isSelected}>
                <span className="flex flex-col">
                  <span>{choice.label}</span>
                  {choice.description ? (
                    <span className="text-xs text-muted-foreground">
                      {choice.description}
                    </span>
                  ) : null}
                </span>
              </ChoiceRow>
            </button>
          );
        })}
        {/* The answer none of the choices are, as one more row: typed into
            rather than clicked. */}
        <div
          className={cn(
            rowClassName(hasOwn),
            !hasOwn && "focus-within:bg-foreground/5",
          )}
        >
          <ChoiceRow isMulti={isMulti} isSelected={hasOwn}>
            <input
              aria-label="Your own answer"
              className="w-full bg-transparent py-0.5 outline-none placeholder:text-muted-foreground"
              onChange={(event) => {
                onOwn(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  onSubmitOwn();
                }
              }}
              placeholder="Something else…"
              value={draft.own}
            />
          </ChoiceRow>
        </div>
      </div>
    </>
  );
}

/** The headers of a card of several questions, each a way back to its question, then Review. */
function Steps({
  drafts,
  onStep,
  questions,
  step,
}: {
  drafts: Draft[];
  onStep: (step: number) => void;
  questions: ChooseQuestion[];
  step: number;
}) {
  const labels = [
    ...questions.map((question, index) => ({
      draft: drafts[index] ?? EMPTY_DRAFT,
      label: question.header || `Question ${index + 1}`,
    })),
    { draft: undefined, label: "Review" },
  ];
  return (
    <div className="-mx-1.5 mb-3 flex flex-wrap items-center gap-1 border-b border-border pb-2">
      {labels.map(({ draft, label }, index) => {
        const isCurrent = index === step;
        const isAnswered = draft !== undefined && hasReply(draft);
        const isSkipped = draft?.skipped === true;
        return (
          <button
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs outline-none focus-visible:outline-2 focus-visible:outline-ring/60",
              isCurrent
                ? "bg-foreground/8 font-medium text-foreground"
                : isAnswered
                  ? "text-foreground/80 hover:bg-foreground/5"
                  : "text-muted-foreground hover:bg-foreground/5",
            )}
            key={index}
            onClick={() => {
              onStep(index);
            }}
            type="button"
          >
            {isAnswered ? (
              <CheckIcon
                className="size-3 text-brand-600 dark:text-brand-400"
                weight="bold"
              />
            ) : isSkipped ? (
              <MinusIcon className="size-3" weight="bold" />
            ) : draft ? (
              <span className="text-muted-foreground/70 tabular-nums">
                {index + 1}
              </span>
            ) : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SendButton({
  children,
  disabled,
  icon = "send",
  onClick,
}: {
  children: ReactNode;
  disabled: boolean;
  icon?: "next" | "send";
  onClick: () => void;
}) {
  const Icon = icon === "next" ? ArrowRightIcon : ArrowUpIcon;
  return (
    <Button disabled={disabled} onClick={onClick} size="xs" variant="brand">
      {children}
      <Icon className="size-3" weight="bold" />
    </Button>
  );
}

/**
 * A card that is no longer open: a line per question with its answer, and
 * the note under them. The line opens to show every choice the agent
 * offered, the picked ones marked, so what else there was stays findable
 * without the card looking answerable.
 */
function AnsweredCard({
  answer,
  ended,
  questions,
}: {
  answer: ChooseOutput | undefined;
  ended: boolean;
  questions: ChooseQuestion[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isSeveral = questions.length > 1;
  return (
    <ToolCard className="rounded-xl">
      <button
        aria-expanded={isExpanded}
        className="group/answered flex w-full flex-col gap-0.5 px-3 py-2 text-left text-[13px] outline-none focus-visible:bg-foreground/5"
        onClick={() => {
          setIsExpanded((open) => !open);
        }}
        type="button"
      >
        {questions.map((question, index) => {
          const reply = answer?.replies[index];
          const picked = reply && "picked" in reply ? reply.picked : undefined;
          return (
            <span className="flex w-full items-center gap-2" key={index}>
              {picked ? (
                <CheckIcon
                  className="size-3.5 shrink-0 text-brand-600 dark:text-brand-400"
                  weight="bold"
                />
              ) : (
                <MinusIcon className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span
                className={cn(
                  "text-muted-foreground",
                  isSeveral ? "w-28 shrink-0 truncate" : "min-w-0 truncate",
                )}
              >
                {isSeveral
                  ? question.header || question.question
                  : question.question}
              </span>
              <span
                className={cn(
                  "min-w-0 truncate",
                  picked ? "font-medium" : "text-muted-foreground",
                  !isSeveral && "shrink-0",
                )}
              >
                {picked
                  ? picked.join(", ")
                  : reply
                    ? "Skipped"
                    : ended
                      ? "No answer"
                      : ""}
              </span>
              {index === 0 ? (
                <CaretDownIcon
                  className={cn(
                    "ml-auto size-3 shrink-0 text-muted-foreground transition-transform",
                    isExpanded && "rotate-180",
                  )}
                />
              ) : null}
            </span>
          );
        })}
      </button>
      {isExpanded ? (
        <div className="flex flex-col gap-3 px-3 pb-2.5 pl-8.5 text-[13px]">
          {questions.map((question, index) => {
            const reply = answer?.replies[index];
            const picked = reply && "picked" in reply ? reply.picked : [];
            const labels = question.choices.map((choice) => choice.label);
            const own = picked.filter((each) => !labels.includes(each));
            return (
              <div key={index}>
                {isSeveral ? (
                  <p className="mb-0.5 text-muted-foreground">
                    {question.question}
                  </p>
                ) : null}
                <ul className="flex flex-col gap-0.5">
                  {[...labels, ...own].map((label) => (
                    <li
                      className={
                        picked.includes(label)
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }
                      key={label}
                    >
                      {label}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
      {answer?.note ? (
        <p className="mx-3 mb-2.5 border-l-2 pl-2.5 text-xs whitespace-pre-wrap text-muted-foreground">
          {answer.note}
        </p>
      ) : null}
    </ToolCard>
  );
}

export function ToolChoose({
  part,
  chatId,
}: {
  part: ChoosePart;
  chatId: ChatId;
}) {
  const answer = useMutation(
    rpcClient.workspace.chats.answerQuestion.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't send your answer", { cause: error });
      },
    }),
  );

  // The card stays open on the chat until it is answered, skipped, or the
  // person writes in the chat instead, whatever has happened to the turn
  // that asked it.
  const asks = useQuery(
    rpcClient.workspace.chats.live.asks.experimental_liveOptions({
      input: { id: chatId },
    }),
  ).data;
  const ask = asks?.find(
    (open) =>
      open.kind === "question" &&
      open.askers.some((asker) => asker.partId === part.metadata.id),
  );
  // Held from the click until the answer lands in the part, not just while
  // the call is pending: the call settles before the part's update brings the
  // answer, and the card falling back to open in between reads as the click
  // not taking. A failure clears it so the card opens again.
  const [sending, setSending] = useState<ChooseOutput>();

  const questions = chooseQuestions(part.input);
  if (questions.length === 0) {
    return <ToolCardEmpty message="The question has not arrived yet." />;
  }

  const output =
    part.state === "output-available" ? chooseAnswer(part.output) : undefined;
  // Answerable once the call has returned, which is what the answer is
  // written onto.
  const isOpen =
    ask !== undefined &&
    output === undefined &&
    part.state === "output-available";

  return (
    <QuestionCard
      onAnswer={(answered) => {
        if (!ask) {
          return;
        }
        setSending(answered);
        answer.mutate(
          { answer: answered, askId: ask.id, id: chatId },
          {
            onError: () => {
              setSending(undefined);
            },
          },
        );
      }}
      output={output}
      questions={questions}
      sending={output === undefined ? sending : undefined}
      status={
        // Closed with no answer drawn while the chat's asks load, so the card
        // neither offers buttons nor says it ended before it knows.
        output !== undefined || asks === undefined
          ? "closed"
          : isOpen || sending !== undefined
            ? "open"
            : "ended"
      }
    />
  );
}

/**
 * A mark beside each choice, so it reads as one thing to pick among several
 * before it is picked: a ring for a question of one answer, a box for one of
 * several, filled with a check once chosen.
 */
function ChoiceRow({
  children,
  isMulti,
  isSelected,
}: {
  children: ReactNode;
  isMulti: boolean;
  isSelected: boolean;
}) {
  return (
    <>
      {/* Hollow rather than filled with the page's background, which in dark
          mode is darker than the card and drew every ring as a black dot. */}
      <span
        aria-hidden
        className={cn(
          "grid size-4.5 shrink-0 place-items-center self-start border",
          isMulti ? "rounded-[5px]" : "rounded-full",
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

function rowClassName(isSelected: boolean) {
  // Rows as a menu draws them, highlighted under the pointer rather than each
  // boxed in a border: the marks already say these are things to pick.
  return cn(
    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm",
    isSelected
      ? "bg-brand-500/10 text-foreground"
      : "group/choice text-foreground outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/60",
  );
}
