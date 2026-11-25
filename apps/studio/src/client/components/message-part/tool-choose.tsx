import { rpcClient } from "@/client/rpc/client";
import {
  type ChatId,
  chooseAnswer,
  chooseInReply,
  type ChooseQuestion,
  chooseQuestions,
  type SessionMessageDataPart,
  type SessionMessagePart,
  QUESTION_SKIP,
} from "@instrument-org/workspace/client";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "@/client/lib/toast";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  DictationControls,
  DictationReadout,
  useCanDictate,
  useDictatedText,
} from "../dictation-controls";
import { type Dictation, isDictating } from "@/client/hooks/use-dictation";
import { focusDockedCard } from "../composer-dock";
import { CodeBlockWrapContext } from "../code-block";
import { Markdown } from "../markdown";
import { MarkdownTableModal } from "../markdown-table-modal";
import { SessionMarkdown } from "../session-markdown";
import { ToolCard, ToolCardEmpty } from "./tool-card";

/** The answer to a card: a reply to each of its questions, and a note. */
export type ChooseOutput = SessionMessageDataPart.QuestionCardAnswer;

type ChoosePart = Extract<SessionMessagePart.ToolPart, { type: "tool-choose" }>;

type Choice = ChooseQuestion["choices"][number];

/** How long the pointer rests on a choice before the detail area follows it. */
export const DETAIL_HOVER_REST_MS = 150;

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

function isSettled(draft: Draft) {
  return draft.skipped || hasReply(draft);
}

/**
 * A card of one to four questions, drawn from nothing but what it asks and
 * how it was answered, so it can be drawn without a session behind it.
 *
 * While `open`, it shows one question at a time under a header with the
 * question, where it is among several ("2 of 4") with a way back and
 * forward, and a close that skips every question not answered yet. A click
 * on a choice of a question of one answer is that answer: the card moves on
 * to the next question still waiting, or sends once none is. A question of
 * several answers counts its picks and moves on with its arrow. Every
 * question has a row for the person's own words, Skip, and the arrow, which
 * waits until the question has an answer and then takes the place of Skip:
 * Next while another question still waits, Send once none does. A question whose
 * choices carry `detail` shows it beside the choices, or under them in a
 * narrow chat, for the choice the keyboard is on or the pointer rests on.
 *
 * `ended` is a card nothing is listening to any more; `closed` is one that
 * was answered or failed, and `inReply` one the person answered by writing
 * in the chat instead. Anything but open draws whole, each question over its
 * answer.
 *
 * `sending` is an answer on its way, drawn as given before the agent has it.
 * `place` says where an open card is among several waiting ("1 of 2").
 * `onShown` hears which question is on show, so a reply typed in the chat
 * ("2") can be read against it.
 *
 * Each choice carries its number as a label, so a reply typed in the chat
 * can name it.
 */
export function QuestionCard({
  inReply = false,
  onAnswer,
  onShown,
  output,
  place,
  questions,
  sending,
  status,
}: {
  inReply?: boolean;
  onAnswer: (output: ChooseOutput) => void;
  onShown?: (at: number) => void;
  output?: ChooseOutput;
  place?: string;
  questions: ChooseQuestion[];
  sending?: ChooseOutput;
  status: "closed" | "ended" | "open";
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [step, setStep] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const isOpen = status === "open" && sending === undefined;
  const draftAt = (index: number) => drafts[index] ?? EMPTY_DRAFT;
  const typeOwnAt = (index: number, own: string) => {
    setDrafts((all) =>
      questions.map((question, each) => {
        const draft = all[each] ?? EMPTY_DRAFT;
        return each === index
          ? {
              own,
              // Their own words are the answer to a question of one choice,
              // so a choice picked before goes.
              picked:
                question.multiSelect || own.trim() === "" ? draft.picked : [],
              skipped: false,
            }
          : draft;
      }),
    );
  };
  // The question a take into the own-answer row writes into: the one on show
  // as it starts, kept until its words land, whichever step is on show then.
  const [ownAt, setOwnAt] = useState(0);
  const ownDictation = useDictatedText({
    onChange: (own) => {
      typeOwnAt(ownAt, own);
    },
    surface: "question-note",
    value: draftAt(ownAt).own,
  });
  if (!isDictating(ownDictation.phase) && ownAt !== step) {
    setOwnAt(step);
  }
  // The box goes once the card stops being open, so a take still recording
  // into it is thrown away rather than left on with no controls.
  const cancelDictation = useEffectEvent(() => {
    ownDictation.cancel();
  });
  useEffect(() => {
    if (!isOpen) {
      cancelDictation();
    }
  }, [isOpen]);
  const tellShown = useEffectEvent((at: number) => {
    onShown?.(at);
  });
  useEffect(() => {
    if (isOpen) {
      tellShown(step);
    }
  }, [isOpen, step]);
  // Moving between steps hides the one the keyboard was in, so it goes on to
  // the step on show rather than falling out of the card.
  const shownStep = useRef(step);
  useLayoutEffect(() => {
    if (shownStep.current === step) {
      return;
    }
    shownStep.current = step;
    const card = cardRef.current;
    const focused = document.activeElement;
    if (
      card &&
      focused !== null &&
      card.contains(focused) &&
      focused.closest("[inert]") !== null
    ) {
      focusDockedCard(card);
    }
  }, [step]);

  if (!isOpen) {
    return (
      <AnsweredCard
        answer={output ?? sending}
        ended={status === "ended"}
        inReply={inReply && (output ?? sending) === undefined}
        questions={questions}
      />
    );
  }

  // Answering waits for dictated words, so they go with it.
  const isHolding = isDictating(ownDictation.phase);
  const isSeveral = questions.length > 1;
  const current = draftAt(step);
  const question = questions[step];

  /**
   * Settles the question on show with `draft`, then moves on to the next
   * question still waiting, or sends every answer once none is.
   */
  const settle = (draft: Draft) => {
    const next = questions.map((_, index) =>
      index === step ? draft : draftAt(index),
    );
    setDrafts(next);
    const waiting = questions.findIndex(
      (_, index) => index > step && !isSettled(next[index] ?? EMPTY_DRAFT),
    );
    const earlier = questions.findIndex(
      (_, index) => !isSettled(next[index] ?? EMPTY_DRAFT),
    );
    const to = waiting === -1 ? earlier : waiting;
    if (to !== -1) {
      setStep(to);
      return;
    }
    if (!isHolding) {
      onAnswer({ replies: next.map(replyOf) });
    }
  };
  /** Skips every question not answered yet, sending the answers given. */
  const close = () => {
    if (isHolding) {
      return;
    }
    onAnswer({
      replies: questions.map((_, index) => {
        const draft = draftAt(index);
        return replyOf(hasReply(draft) ? draft : { ...draft, skipped: true });
      }),
    });
  };

  const pick = (label: string) => {
    if (question?.multiSelect) {
      setDrafts(
        questions.map((_, index) => {
          const draft = draftAt(index);
          return index === step
            ? {
                ...draft,
                picked: draft.picked.includes(label)
                  ? draft.picked.filter((each) => each !== label)
                  : [...draft.picked, label],
                skipped: false,
              }
            : draft;
        }),
      );
      return;
    }
    settle({ own: "", picked: [label], skipped: false });
  };
  const submitOwn = () => {
    if (hasReply(current)) {
      settle(current);
    }
  };
  const skip = () => {
    settle({ ...EMPTY_DRAFT, skipped: true });
  };
  const pickedCount =
    current.picked.length + (current.own.trim() === "" ? 0 : 1);
  const isAnswered = hasReply(current);
  const sends = questions.every(
    (_, index) => index === step || isSettled(draftAt(index)),
  );

  return (
    <ToolCard>
      <div
        className="@container/question flex flex-col gap-2 px-3 pt-3 pb-2"
        ref={cardRef}
      >
        <div className="flex items-start gap-3 px-1">
          {isSeveral ? (
            // Every question's words laid out in the one cell, so the header
            // keeps the height of the longest as the person moves between them.
            <div className="grid min-w-0 flex-1 pt-0.5">
              {questions.map((each, index) => (
                <p
                  aria-hidden={index !== step}
                  className={cn(
                    "col-start-1 row-start-1 text-sm font-medium text-pretty",
                    index !== step && "invisible",
                  )}
                  key={index}
                >
                  {each.question}
                </p>
              ))}
            </div>
          ) : (
            <p className="min-w-0 flex-1 pt-0.5 text-sm font-medium text-pretty">
              {question?.question}
            </p>
          )}
          <span className="flex shrink-0 items-center gap-1">
            {isSeveral ? (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <Button
                  aria-label="Previous question"
                  className="size-6 text-muted-foreground"
                  disabled={step === 0}
                  onClick={() => {
                    setStep((at) => Math.max(0, at - 1));
                  }}
                  size="icon"
                  variant="ghost"
                >
                  <CaretLeftIcon className="size-3.5" />
                </Button>
                <span className="tabular-nums">
                  {`${String(step + 1)} of ${String(questions.length)}`}
                </span>
                <Button
                  aria-label="Next question"
                  className="size-6 text-muted-foreground"
                  disabled={step === questions.length - 1}
                  onClick={() => {
                    setStep((at) => Math.min(questions.length - 1, at + 1));
                  }}
                  size="icon"
                  variant="ghost"
                >
                  <CaretRightIcon className="size-3.5" />
                </Button>
              </span>
            ) : null}
            <Button
              aria-label="Close"
              className="size-6 text-muted-foreground"
              disabled={isHolding}
              onClick={close}
              size="icon"
              variant="ghost"
            >
              <XIcon className="size-3.5" />
            </Button>
          </span>
        </div>

        {isSeveral ? (
          // Every step is laid out in the one cell and all but the current
          // one hidden, so the card keeps the height of its tallest step
          // rather than resizing as the person moves between them.
          <div className="grid">
            {questions.map((each, index) => (
              <div
                className={cn(
                  "col-start-1 row-start-1",
                  index !== step && "invisible",
                )}
                inert={index !== step}
                key={index}
              >
                <QuestionStep
                  dictation={index === ownAt ? ownDictation : undefined}
                  draft={draftAt(index)}
                  onOwn={(own) => {
                    typeOwnAt(index, own);
                  }}
                  onPick={pick}
                  onSubmitOwn={submitOwn}
                  question={each}
                />
              </div>
            ))}
          </div>
        ) : question ? (
          <QuestionStep
            dictation={ownDictation}
            draft={current}
            onOwn={(own) => {
              typeOwnAt(step, own);
            }}
            onPick={pick}
            onSubmitOwn={submitOwn}
            question={question}
          />
        ) : null}

        <div className="flex items-center gap-2 border-t border-border px-1 pt-2">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground tabular-nums">
            {question?.multiSelect
              ? `${String(pickedCount)} picked`
              : (place ?? "")}
          </span>
          {/* Kept in the layout once answered, so the arrow stays put. */}
          <Button
            aria-hidden={isAnswered}
            className={cn("text-muted-foreground", isAnswered && "invisible")}
            disabled={isHolding}
            onClick={skip}
            size="xs"
            variant="ghost"
          >
            {QUESTION_SKIP}
          </Button>
          <Button
            aria-label={sends ? "Send" : "Next"}
            className="size-7 rounded-full"
            disabled={isHolding || !isAnswered}
            onClick={() => {
              settle(current);
            }}
            size="icon"
            variant="brand"
          >
            <ArrowRightIcon className="size-3.5" weight="bold" />
          </Button>
        </div>
      </div>
    </ToolCard>
  );
}

/**
 * One question while the card is open: its choices and a row for the
 * person's own words, and, when any choice carries detail, the area that
 * shows it: beside the choices in a wide chat, under them in a narrow one.
 */
function QuestionStep({
  dictation,
  draft,
  onOwn,
  onPick,
  onSubmitOwn,
  question,
}: {
  /** The microphone of the own-answer row, on the step a take writes into. */
  dictation?: Dictation;
  draft: Draft;
  onOwn: (own: string) => void;
  onPick: (label: string) => void;
  onSubmitOwn: () => void;
  question: ChooseQuestion;
}) {
  const canDictate = useCanDictate();
  const isMulti = question.multiSelect === true;
  const hasOwn = draft.own.trim() !== "";
  const isOwnDictating =
    dictation !== undefined && isDictating(dictation.phase);
  const hasDetail = question.choices.some((choice) => choice.detail);
  // The choice the detail area shows: the first until the keyboard or the
  // pointer says otherwise.
  const [shown, setShown] = useState(0);
  const rest = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stopResting = () => {
    clearTimeout(rest.current);
    rest.current = undefined;
  };
  useEffect(() => stopResting, []);

  const choices = (
    <ChoiceList role={isMulti ? "group" : "radiogroup"}>
      {question.choices.map((choice, index) => {
        const isSelected = draft.picked.includes(choice.label);
        return (
          <button
            aria-checked={isSelected}
            className={rowClassName(isSelected)}
            data-card-home={index === 0 ? "" : undefined}
            data-choice=""
            key={index}
            onClick={() => {
              onPick(choice.label);
            }}
            onFocus={() => {
              stopResting();
              setShown(index);
            }}
            // The detail follows only a pointer that rests, so crossing other
            // choices on the way to it leaves it as it was.
            onPointerEnter={() => {
              stopResting();
              rest.current = setTimeout(() => {
                setShown(index);
              }, DETAIL_HOVER_REST_MS);
            }}
            onPointerLeave={stopResting}
            role={isMulti ? "checkbox" : "radio"}
            // Named, so the window's keyboard home lands on the first
            // choice rather than on whatever button comes first.
            tabIndex={index === 0 ? 0 : undefined}
            type="button"
          >
            {/* A label a reply typed in the chat can name it by. */}
            <ChoiceNumber isMulti={isMulti} isSelected={isSelected}>
              {index + 1}
            </ChoiceNumber>
            <span className="flex min-w-0 flex-1 flex-col pt-0.5">
              <span>{choice.label}</span>
              {choice.description ? (
                <span className="text-xs text-muted-foreground">
                  {choice.description}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
      {/* The answer none of the choices are, as one more row: typed into
          rather than clicked, growing a line at a time like the reply box
          up to a few lines, then scrolling. */}
      <div
        className={cn(
          rowClassName(hasOwn),
          !hasOwn && "focus-within:bg-foreground/5",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid size-6 shrink-0 place-items-center self-start border text-muted-foreground",
            isMulti ? "rounded-md" : "rounded-full",
            hasOwn
              ? "border-brand-600 bg-brand-600 text-brand-foreground"
              : "border-dashed border-foreground/25",
          )}
        >
          <PencilSimpleIcon className="size-3" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-start gap-2">
            <textarea
              aria-label="Your own answer"
              className="field-sizing-content max-h-32 min-w-0 flex-1 resize-none bg-transparent py-0.5 outline-none placeholder:text-muted-foreground"
              onChange={(event) => {
                onOwn(event.target.value);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  onSubmitOwn();
                }
              }}
              placeholder="Something else…"
              rows={1}
              value={draft.own}
            />
            {dictation && (canDictate || isOwnDictating) ? (
              // Pulled into the row's padding, so the microphone leaves
              // the row a line tall.
              <DictationControls
                className="-my-1 -mr-1"
                dictation={dictation}
                size="sm"
              />
            ) : null}
          </span>
          {dictation && isOwnDictating ? (
            <DictationReadout dictation={dictation} />
          ) : null}
        </span>
      </div>
    </ChoiceList>
  );

  const shownChoice = question.choices[shown] ?? question.choices[0];
  if (!hasDetail || shownChoice === undefined) {
    return choices;
  }
  return (
    // Wide enough, the detail sits beside the choices at their height;
    // narrower, it sits under them, short until the pointer is on it.
    <div className="flex flex-col gap-3 @2xl/question:flex-row @2xl/question:items-stretch">
      <div className="min-w-0 @2xl/question:w-[46%] @2xl/question:shrink-0">
        {choices}
      </div>
      <DetailArea choice={shownChoice} />
    </div>
  );
}

/**
 * What the choice being looked at means: its detail as Markdown, drawn as a
 * reply is, scrolling inside the area; or, for a choice without any, its own
 * label and description, so the area never stands empty. An expand opens the
 * detail with room to read it.
 */
function DetailArea({ choice }: { choice: Choice }) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div
      className="group/detail relative min-w-0 rounded-xl bg-background ring-1 ring-border/70 @2xl/question:min-h-40 @2xl/question:flex-1"
      data-detail=""
    >
      <div
        className={cn(
          "overflow-y-auto p-4 pr-11",
          // Narrow, it stays a few lines tall until the pointer is on it;
          // wide, it fills the height the choices give it.
          "max-h-24 transition-[max-height] duration-200 group-hover/detail:max-h-72 motion-reduce:transition-none",
          "@2xl/question:absolute @2xl/question:inset-0 @2xl/question:max-h-none",
        )}
      >
        {choice.detail ? (
          <CodeBlockWrapContext value={false}>
            <SessionMarkdown markdown={choice.detail} />
          </CodeBlockWrapContext>
        ) : (
          <div className="flex h-full flex-col justify-center" data-restated="">
            <p className="text-sm font-medium">{choice.label}</p>
            {choice.description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {choice.description}
              </p>
            ) : null}
          </div>
        )}
      </div>
      {choice.detail ? (
        <Button
          aria-label="Expand detail"
          className="absolute top-2 right-2 size-7 bg-card text-muted-foreground ring-1 ring-border/70"
          onClick={() => {
            setIsExpanded(true);
          }}
          size="icon"
          variant="ghost"
        >
          <ArrowsOutSimpleIcon className="size-3.5" />
        </Button>
      ) : null}
      {isExpanded && choice.detail ? (
        <MarkdownTableModal
          onOpenChange={setIsExpanded}
          open
          title={choice.label}
        >
          <CodeBlockWrapContext value={false}>
            <Markdown markdown={choice.detail} />
          </CodeBlockWrapContext>
        </MarkdownTableModal>
      ) : null}
    </div>
  );
}

/**
 * The rows of a question, pulled out by their own padding so the marks line
 * up with the question while a highlighted row still has room around its
 * text. In a chat's composer they stop at a share of the chat's height
 * (`--conversation-height`, set by the chat) and scroll, with a fade along
 * each edge while there is more past it, so the question and Skip stay in
 * view. A field typed into keeps its whole row in view as it grows, so the
 * line being written is never under the fade.
 */
function ChoiceList({
  children,
  role,
}: {
  children: ReactNode;
  role: "group" | "radiogroup";
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ above: false, below: false });
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const observer = new ResizeObserver(() => {
      revealTypedRow(list);
      setMore(moreOf(list));
    });
    observer.observe(list);
    for (const row of list.children) {
      observer.observe(row);
    }
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div className="relative -mx-2">
      {/* Positioned, so each row's offsetTop is measured from the list. */}
      <div
        className="relative flex max-h-[calc(var(--conversation-height)*0.4)] flex-col gap-0.5 overflow-y-auto *:shrink-0"
        onFocus={(event) => {
          revealTypedRow(event.currentTarget);
        }}
        onScroll={(event) => {
          setMore(moreOf(event.currentTarget));
        }}
        ref={listRef}
        role={role}
      >
        {children}
      </div>
      {more.above ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-linear-to-b from-card to-transparent"
        />
      ) : null}
      {more.below ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-card to-transparent"
        />
      ) : null}
    </div>
  );
}

function moreOf(list: HTMLElement) {
  return {
    above: list.scrollTop > 1,
    below: list.scrollHeight - list.scrollTop - list.clientHeight > 1,
  };
}

/** Scrolls the list until the row of a focused field in it ends inside it. */
function revealTypedRow(list: HTMLElement) {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLTextAreaElement) || !list.contains(focused)) {
    return;
  }
  const row = [...list.children].find((each) => each.contains(focused));
  if (!(row instanceof HTMLElement)) {
    return;
  }
  const bottom = row.offsetTop + row.offsetHeight;
  if (bottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = bottom - list.clientHeight;
  }
}

/**
 * A question that is no longer open, kept whole where it was asked: each
 * question's own words as a muted heading, its answer under it. The words
 * are the question rather than its header, since a reply that goes on to
 * discuss the answers (grading a quiz) reads against what was asked. A
 * choice picked reads as its label, the person's own words in quotes, a
 * question skipped as skipped. A card answered by a reply in the chat says
 * so once, under its questions, with no choices to read a number against.
 */
function AnsweredCard({
  answer,
  ended,
  inReply,
  questions,
}: {
  answer: ChooseOutput | undefined;
  ended: boolean;
  inReply: boolean;
  questions: ChooseQuestion[];
}) {
  return (
    <div className="my-2 flex max-w-xl min-w-0 flex-col gap-3.5 rounded-2xl border border-border bg-card px-4 py-3.5">
      {questions.map((question, index) => {
        const reply = answer?.replies[index];
        const labels = question.choices.map((choice) => choice.label);
        const picked = reply && "picked" in reply ? reply.picked : undefined;
        const said = inReply
          ? undefined
          : (picked
              ?.map((each) => (labels.includes(each) ? each : `“${each}”`))
              .join(", ") ??
            (reply ? "Skipped" : ended ? "No answer" : undefined));
        return (
          <div className="flex flex-col gap-0.5" key={index}>
            <p className="text-[13px] text-pretty text-muted-foreground">
              {question.question || question.header}
            </p>
            {said === undefined ? null : (
              <p
                className={cn(
                  "text-sm text-pretty",
                  picked === undefined && "text-muted-foreground",
                )}
              >
                {said}
              </p>
            )}
          </div>
        );
      })}
      {inReply ? (
        <p className="-mt-3 text-sm text-muted-foreground">
          Answered in your reply
        </p>
      ) : null}
      {answer?.note ? (
        <p className="border-l-2 pl-2.5 text-xs whitespace-pre-wrap text-muted-foreground">
          {answer.note}
        </p>
      ) : null}
    </div>
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
  // that asked it. One that carries its card waits by the composer instead
  // (`QuestionDock`), once the turn that asked it is over.
  const asks = useQuery(
    rpcClient.workspace.chats.live.asks.experimental_liveOptions({
      input: { id: chatId },
    }),
  ).data;
  const ask = asks?.find(
    (open): open is Extract<typeof open, { kind: "question" }> =>
      open.kind === "question" &&
      open.askers.some((asker) => asker.partId === part.metadata.id),
  );
  // Held from the click until the answer lands in the part, not just while
  // the call is pending: the call settles before the part's update brings the
  // answer, and the card falling back to open in between reads as the click
  // not taking. A failure clears it so the card opens again.
  const [sending, setSending] = useState<ChooseOutput>();

  // A call still streaming in has asked nothing yet, and the questions it
  // asks go up by the composer once its turn is over, so drawing them here
  // first would show each one twice.
  if (
    ask === undefined &&
    (part.state === "input-streaming" || part.state === "input-available")
  ) {
    return null;
  }

  const questions = chooseQuestions(part.input);
  if (questions.length === 0) {
    return <ToolCardEmpty message="The question has not arrived yet." />;
  }

  const output =
    part.state === "output-available" ? chooseAnswer(part.output) : undefined;
  const inReply =
    part.state === "output-available" && chooseInReply(part.output);
  // Answered on any device and not taken yet by the computer that asked,
  // which writes it onto the call: drawn as given meanwhile.
  const given = output === undefined ? ask?.answered : undefined;
  // Answerable once the call has returned, which is what the answer is
  // written onto, and until any device answers it.
  const isOpen =
    ask !== undefined &&
    ask.answerable &&
    output === undefined &&
    !inReply &&
    part.state === "output-available";
  if (
    ask?.card !== undefined &&
    output === undefined &&
    !inReply &&
    given === undefined &&
    sending === undefined
  ) {
    return ask.held ? null : (
      <p className="mt-2 px-1 text-[13px] text-muted-foreground">
        {`${ask.question} `}
        <span className="text-muted-foreground/70">You can answer below.</span>
      </p>
    );
  }
  const line =
    ask === undefined || output !== undefined
      ? undefined
      : given && !ask.here
        ? `You answered from ${given.by}. ${ask.computer} needs to be on for it to take effect.`
        : !given && ask.away
          ? `${ask.here ? "This computer" : ask.computer} wasn’t available when you answered on ${ask.away.by}. Please answer again.`
          : undefined;

  const card = (
    <QuestionCard
      inReply={inReply}
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
      sending={output === undefined ? (sending ?? given?.answer) : undefined}
      status={
        // Closed with no answer drawn while the chat's asks load, so the card
        // neither offers buttons nor says it ended before it knows.
        output !== undefined || inReply || asks === undefined
          ? "closed"
          : isOpen || sending !== undefined || given !== undefined
            ? "open"
            : "ended"
      }
    />
  );
  return line === undefined ? (
    card
  ) : (
    <div>
      {card}
      <p className="mt-1.5 px-1 text-[13px] text-muted-foreground">{line}</p>
    </div>
  );
}

/**
 * A choice's number in the mark beside it, so it reads as one thing to pick
 * among several and as the label a reply can name it by: a circle for a
 * question of one answer, a rounded square for one of several, filled once
 * picked.
 */
function ChoiceNumber({
  children,
  isMulti,
  isSelected,
}: {
  children: ReactNode;
  isMulti: boolean;
  isSelected: boolean;
}) {
  return (
    // Hollow rather than filled with the page's background, which in dark
    // mode is darker than the card and drew every mark as a black dot.
    <span
      aria-hidden
      className={cn(
        "grid size-6 shrink-0 place-items-center self-start border text-xs font-medium tabular-nums",
        isMulti ? "rounded-md" : "rounded-full",
        isSelected
          ? "border-brand-600 bg-brand-600 text-brand-foreground"
          : "border-foreground/20 text-muted-foreground group-hover/choice:border-foreground/45",
      )}
    >
      {children}
    </span>
  );
}

function rowClassName(isSelected: boolean) {
  // Rows as a menu draws them, highlighted under the pointer rather than each
  // boxed in a border: the marks already say these are things to pick.
  // The ring sits inside the row: the list scrolls, and clips anything
  // drawn past its sides.
  return cn(
    "flex w-full items-start gap-3 rounded-lg px-2 py-1.5 text-left text-sm outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/60",
    isSelected
      ? "bg-brand-500/10 text-foreground"
      : "group/choice text-foreground hover:bg-foreground/5 focus-visible:bg-foreground/5",
  );
}
