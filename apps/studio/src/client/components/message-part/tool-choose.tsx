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
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { MinusIcon } from "@phosphor-icons/react/Minus";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type KeyboardEvent,
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
  DictatedTextarea,
  DictationControls,
  DictationReadout,
  useCanDictate,
  useDictatedText,
} from "../dictation-controls";
import { type Dictation, isDictating } from "@/client/hooks/use-dictation";
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
 * `place` says where an open card is among several waiting ("1 of 2").
 *
 * While focus is in an open card and not in a field, a digit picks that
 * choice of the question on show and Enter sends (or moves on) once it has
 * an answer. `onChatAbout` offers writing back in the chat instead, under
 * the choices; `collapsed` then draws the card as one row naming the
 * question, with `onBack` to open it again, and keeps what was picked.
 */
export function QuestionCard({
  collapsed = false,
  onAnswer,
  onBack,
  onChatAbout,
  output,
  place,
  questions,
  sending,
  status,
}: {
  collapsed?: boolean;
  onAnswer: (output: ChooseOutput) => void;
  onBack?: () => void;
  onChatAbout?: () => void;
  output?: ChooseOutput;
  place?: string;
  questions: ChooseQuestion[];
  sending?: ChooseOutput;
  status: "closed" | "ended" | "open";
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [step, setStep] = useState(0);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);

  const isOpen = status === "open" && sending === undefined;
  const noteDictation = useDictatedText({
    onChange: setNote,
    surface: "question-note",
    value: note,
  });
  const draftAt = (index: number) => drafts[index] ?? EMPTY_DRAFT;
  const setDraft = (index: number, change: (draft: Draft) => Draft) => {
    setDrafts((all) =>
      questions.map((_, each) =>
        each === index
          ? change(all[each] ?? EMPTY_DRAFT)
          : (all[each] ?? EMPTY_DRAFT),
      ),
    );
  };
  const typeOwnAt = (index: number, own: string) => {
    setDraft(index, (draft) => ({
      own,
      // Their own words are the answer to a question of one choice, so a
      // choice picked before goes.
      picked:
        questions[index]?.multiSelect || own.trim() === "" ? draft.picked : [],
      skipped: false,
    }));
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
  // The boxes go once the card stops being open or folds to its row, so a
  // take still recording into one is thrown away rather than left on with no
  // controls.
  const cancelDictation = useEffectEvent(() => {
    noteDictation.cancel();
    ownDictation.cancel();
  });
  useEffect(() => {
    if (!isOpen || collapsed) {
      cancelDictation();
    }
  }, [isOpen, collapsed]);
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
      focusQuestionCard(card);
    }
  }, [step]);

  if (!isOpen) {
    return (
      <AnsweredCard
        answer={output ?? sending}
        ended={status === "ended"}
        questions={questions}
      />
    );
  }

  // Answering waits for dictated words, so they go with it.
  const isHolding =
    isDictating(noteDictation.phase) || isDictating(ownDictation.phase);
  const isSeveral = questions.length > 1;
  const isReview = isSeveral && step >= questions.length;
  const current = draftAt(step);
  const question = questions[step];

  if (collapsed) {
    return (
      <ToolCard>
        <div className="flex h-10 items-center gap-2 pr-1.5 pl-4">
          <QuestionIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
            {(question ?? questions[0])?.question}
          </span>
          <Button
            className="shrink-0 font-medium"
            onClick={onBack}
            size="xs"
            variant="ghost"
          >
            Back to question
          </Button>
        </div>
      </ToolCard>
    );
  }

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

  /** What Enter does from the card once there is something to send: Send, or Next on a step. */
  const primary = isReview
    ? isHolding
      ? undefined
      : sendDrafts
    : !hasReply(current)
      ? undefined
      : isSeveral
        ? next
        : isHolding
          ? undefined
          : sendDrafts;
  const onCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing ||
      !(target instanceof HTMLElement) ||
      target.closest("input, textarea, [contenteditable='true']")
    ) {
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const choice = isReview
        ? undefined
        : question?.choices[Number(event.key) - 1];
      if (choice) {
        event.preventDefault();
        pick(choice.label);
      }
      return;
    }
    // A button other than a choice keeps Enter as its own press.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      primary &&
      (target.closest("[data-choice]") || !target.closest("button"))
    ) {
      event.preventDefault();
      primary();
    }
  };

  const noteBox = (
    <DictatedTextarea
      aria-label="Note"
      autoFocus={!isSeveral}
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
      {/* The keys reach the choices inside, each a button of its own. */}
      <div className="px-4 py-3" onKeyDown={onCardKeyDown} ref={cardRef}>
        {isSeveral ? (
          <Steps
            drafts={questions.map((_, index) => draftAt(index))}
            onStep={setStep}
            questions={questions}
            step={step}
          />
        ) : null}

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
            <div
              className={cn(
                "col-start-1 row-start-1",
                !isReview && "invisible",
              )}
              inert={!isReview}
            >
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
                        {"skipped" in reply
                          ? "Skipped"
                          : reply.picked.join(", ")}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              {noteBox}
            </div>
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

        {onChatAbout ? (
          // Across the card under a hairline, apart from the choices it is
          // not one of, with its mark where theirs are.
          <div className="-mx-4 mt-2 border-t border-border px-2 pt-2">
            <button
              className={cn(rowClassName(false), "text-muted-foreground")}
              onClick={onChatAbout}
              type="button"
            >
              <span
                aria-hidden
                className="grid size-4.5 shrink-0 place-items-center"
              >
                <ChatCircleIcon className="size-4" />
              </span>
              Chat about this
            </button>
          </div>
        ) : null}

        {!isSeveral && isNoteOpen ? noteBox : null}

        {/* Pulled out by the buttons' padding, so their words line up with
            the question's edges rather than sitting indented under it. */}
        <div className="-mx-2.5 mt-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1">
            {place ? (
              <span className="px-2.5 text-xs text-muted-foreground tabular-nums">
                {place}
              </span>
            ) : null}
            {isSeveral || isNoteOpen ? null : (
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
          </span>
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
  return (
    <>
      <p className="mb-2 text-sm font-medium text-pretty">
        {question.question}
      </p>
      <ChoiceList role={isMulti ? "group" : "radiogroup"}>
        {question.choices.map((choice, index) => {
          const isSelected = draft.picked.includes(choice.label);
          return (
            <button
              aria-checked={isSelected}
              aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
              className={rowClassName(isSelected)}
              data-card-home={index === 0 ? "" : undefined}
              data-choice=""
              key={index}
              onClick={() => {
                onPick(choice.label);
              }}
              role={isMulti ? "checkbox" : "radio"}
              // Named, so the window's keyboard home lands on the first
              // choice rather than on whatever button comes first.
              tabIndex={index === 0 ? 0 : undefined}
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
            rather than clicked, growing a line at a time like the reply box
            up to a few lines, then scrolling. */}
        <div
          className={cn(
            rowClassName(hasOwn),
            !hasOwn && "focus-within:bg-foreground/5",
          )}
        >
          <ChoiceRow isMulti={isMulti} isSelected={hasOwn}>
            <span className="flex flex-col gap-1">
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
          </ChoiceRow>
        </div>
      </ChoiceList>
    </>
  );
}

/**
 * The rows of a question, pulled out by their own padding so the marks line
 * up with the question while a highlighted row still has room around its
 * text. In a chat's composer they stop at a share of the chat's height
 * (`--conversation-height`, set by the chat) and scroll, with a fade along
 * each edge while there is more past it, so the question and Send stay in
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
 * Puts the keyboard on the first choice of the question on show in an open
 * card under `root`, or on its first button where no choice is on show (the
 * review of a card of several). Returns whether anything took it.
 */
export function focusQuestionCard(root: HTMLElement) {
  const reachable = (element: HTMLElement) =>
    element.closest("[inert]") === null &&
    element.checkVisibility({ visibilityProperty: true });
  const target =
    [...root.querySelectorAll<HTMLElement>("[data-card-home]")].find(
      reachable,
    ) ??
    [...root.querySelectorAll<HTMLElement>("button:not([disabled])")].find(
      reachable,
    );
  target?.focus({ preventScroll: true });
  return target !== undefined;
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
            {/* One width for the number and the marks that replace it, so
                answering a question never moves the headers after it. */}
            {draft ? (
              <span className="grid w-3 shrink-0 place-items-center">
                {isAnswered ? (
                  <CheckIcon
                    className="size-3 text-brand-600 dark:text-brand-400"
                    weight="bold"
                  />
                ) : isSkipped ? (
                  <MinusIcon className="size-3" weight="bold" />
                ) : (
                  <span className="text-muted-foreground/70 tabular-nums">
                    {index + 1}
                  </span>
                )}
              </span>
            ) : null}
            {/* As wide as the label in the current header's weight, so
                moving between steps never moves the headers either. */}
            <span className="grid">
              <span className="col-start-1 row-start-1">{label}</span>
              <span
                aria-hidden
                className="invisible col-start-1 row-start-1 font-medium"
              >
                {label}
              </span>
            </span>
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
 * A question that is no longer open, drawn as a finished step: the question
 * mark on the step's tile, then a line per question with its header and its
 * answer in full, and the note under them. A card whose questions all went
 * unanswered the same way, skipped or never answered, says so once. It opens
 * to show each question whole with every choice the agent offered, the
 * picked ones checked, so what else there was stays findable without the
 * line looking answerable.
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
  const replies = questions.map((_, index) => answer?.replies[index]);
  const unanswered = replies.every((reply) => reply && "skipped" in reply)
    ? "Skipped"
    : ended && replies.every((reply) => reply === undefined)
      ? "No answer"
      : undefined;
  const labelOf = (question: ChooseQuestion) =>
    question.header || question.question;
  const rows = unanswered
    ? [{ label: questions.map(labelOf).join(", "), said: unanswered }]
    : questions.map((question, index) => {
        const reply = replies[index];
        const picked = reply && "picked" in reply ? reply.picked : undefined;
        const labels = question.choices.map((choice) => choice.label);
        return {
          label: labelOf(question),
          picked,
          said:
            picked
              ?.map((each) => (labels.includes(each) ? each : `“${each}”`))
              .join(", ") ?? (reply ? "Skipped" : ended ? "No answer" : ""),
        };
      });
  return (
    <div className="flex max-w-xl min-w-0 flex-col gap-1.5 text-[13px]/5">
      <button
        aria-expanded={isExpanded}
        className="flex flex-col gap-1 self-start rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          setIsExpanded((open) => !open);
        }}
        type="button"
      >
        {rows.map((row, index) => (
          <span className="flex items-start gap-1.5" key={index}>
            {index === 0 ? (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
                <QuestionIcon className="size-3 text-foreground/70" />
              </span>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <span
              className={cn(
                "text-muted-foreground",
                isSeveral && !unanswered
                  ? "w-21 shrink-0 truncate"
                  : "min-w-0 text-pretty",
              )}
            >
              {row.label}
            </span>
            <span
              className={cn(
                "min-w-0 text-pretty",
                "picked" in row && row.picked
                  ? "font-medium"
                  : "text-muted-foreground",
              )}
            >
              {row.said}
            </span>
            {index === 0 ? (
              <CaretDownIcon
                className={cn(
                  "mt-1 size-3 shrink-0 text-muted-foreground transition-transform",
                  isExpanded && "rotate-180",
                )}
              />
            ) : null}
          </span>
        ))}
      </button>
      {answer?.note ? (
        <p className="ml-6.5 border-l-2 pl-2.5 text-xs whitespace-pre-wrap text-muted-foreground">
          {answer.note}
        </p>
      ) : null}
      {isExpanded ? (
        <div className="mt-1 ml-2.5 flex flex-col gap-3 border-l border-border pl-4">
          {questions.map((question, index) => {
            const reply = replies[index];
            const picked = reply && "picked" in reply ? reply.picked : [];
            const labels = question.choices.map((choice) => choice.label);
            const own = picked.filter((each) => !labels.includes(each));
            return (
              <div className="flex flex-col gap-1" key={index}>
                <p className="text-pretty text-muted-foreground">
                  {question.question}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {[...labels, ...own].map((label) =>
                    picked.includes(label) ? (
                      <li className="flex items-start gap-1.5" key={label}>
                        <CheckIcon
                          className="mt-1 size-3 shrink-0 text-brand-600 dark:text-brand-400"
                          weight="bold"
                        />
                        <span className="text-pretty">
                          {labels.includes(label) ? label : `“${label}”`}
                        </span>
                      </li>
                    ) : (
                      <li className="pl-4.5 text-muted-foreground" key={label}>
                        {label}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            );
          })}
        </div>
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
  // Answered on any device and not taken yet by the computer that asked,
  // which writes it onto the call: drawn as given meanwhile.
  const given = output === undefined ? ask?.answered : undefined;
  // Answerable once the call has returned, which is what the answer is
  // written onto, and until any device answers it.
  const isOpen =
    ask !== undefined &&
    ask.answerable &&
    output === undefined &&
    part.state === "output-available";
  if (
    ask?.card !== undefined &&
    output === undefined &&
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
          ? `You answered from ${ask.away.by} while ${ask.here ? "this computer" : ask.computer} was away, so it’s asking again.`
          : undefined;

  const card = (
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
      sending={output === undefined ? (sending ?? given?.answer) : undefined}
      status={
        // Closed with no answer drawn while the chat's asks load, so the card
        // neither offers buttons nor says it ended before it knows.
        output !== undefined || asks === undefined
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
