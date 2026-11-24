import { type ChatSeparator } from "@/client/lib/chat-separators";
import { type InstructionsChange } from "@/client/lib/instructions-changes";
import { workedLine } from "@/client/lib/worked-line";
import {
  type ChatId,
  FOLD_WAIT_MS,
  isTurnFolded,
  type ReplyEnd,
  workCardOf,
  type SessionMessagePart,
  type StepPart,
  type StoreId,
  type Turn,
  type TurnOpener,
  type TurnRow,
} from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type ComponentProps,
  memo,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { AssistantMessage } from "../assistant-message";
import { AssistantMessagesFooter } from "../assistant-messages-footer";
import { SentFileChips } from "../sent-file-chips";
import { SessionMarkdown } from "../session-markdown";
import { CommandCard } from "../task/command-card";
import { ChatSeparatorRow } from "../chat-separator";
import { InstructionsChangesNote } from "../instructions-changes-note";
import { WorkingMark } from "../icons/working-mark";
import { MessageError } from "../message-error";
import { RatingCard } from "../message-part/rating-card";
import { ToolCallBody } from "../message-part/tool-call";
import { SentFolderChips } from "../sent-folder-chips";
import { useReleaseAutoScroll } from "../transcript-scroll-context";
import { MessageScrollerItem, ScrollPin } from "../ui/message-scroller";
import { MessageBubble, UserMessage } from "../user-message";
import { SentChips } from "../window/context-chip";
import {
  CardPresence,
  FOLD_TRANSITION,
  ROW_GAP,
  TURN_GAP,
  useCardOpens,
} from "./card-motion";
import {
  ActivityRowView,
  Badges,
  FoldedActivityView,
  MidDot,
  RowLine,
  StepDetail,
} from "./activity-row";
import { BranchedFromLine } from "./branched-from-line";
import { FoldsOpenedByFind } from "./folds-opened-by-find";
import { NextStepRows, useHasNextSteps } from "./next-steps";
import { useStage } from "./stage/stage-context";
import { renderDataPart } from "./note-part";
import { PageTakeoverNote } from "./page-takeover-note";
import { WorkCardView } from "./work-card";
import { TranscriptSurfaceContext } from "./surface";
import { useTranscriptCommands } from "./transcript-data";
import { TranscriptActionsContext } from "./transcript-actions";
import { TaskCardRow } from "./task-card";
import { formatClock, usePassed, useTicking } from "./time";
import { useWorkingFloor } from "./use-working-floor";

/** How long the agent may sit between things before the transcript says it is thinking. */
const THINKING_AFTER_MS = 1000;

/**
 * A row that opens into place when it comes after the turn is on screen, so
 * what is under it (the live card above all) slides down rather than jumping
 * a row, and closes as the fold takes it, told by `AnimatePresence`'s
 * `custom`. A row leaving for any other reason just goes, or what is under it
 * would slide up for no reason the reader can see.
 *
 * While it opens, the gap above it comes in with it, and its words are moved
 * back by as much on the same curve, so they open where they will stay rather
 * than sliding down the gap's height.
 */
function FoldingRow({
  children,
  id,
  isPinned = false,
  opens,
}: {
  children: ReactNode;
  id: string;
  /** Kept still on screen while rows above it fold (`usePinnedRow`). */
  isPinned?: boolean;
  /** Whether it opens from nothing when it comes, read when it mounts. */
  opens: boolean;
}) {
  const isReduced = useReducedMotion();
  const transition = isReduced ? { duration: 0 } : FOLD_TRANSITION;
  const ref = useRef<HTMLDivElement>(null);
  return (
    <motion.div
      animate="open"
      ref={ref}
      className="flex min-w-0 flex-col has-[>:empty]:hidden"
      data-transcript-row={id}
      exit="leaving"
      initial={opens ? "closed" : false}
      variants={{
        closed: {
          height: 0,
          marginTop: -ROW_GAP,
          opacity: 0,
          overflow: "hidden",
        },
        open: {
          height: "auto",
          marginTop: 0,
          opacity: 1,
          transition,
          transitionEnd: { overflow: "visible" },
        },
        leaving: (isFolding: boolean) =>
          isFolding
            ? {
                height: 0,
                marginTop: -ROW_GAP,
                opacity: 0,
                overflow: "hidden",
                transition,
              }
            : { opacity: 0, transition: { duration: 0 } },
      }}
    >
      <motion.div
        className="flex min-w-0 flex-col gap-2"
        variants={{
          closed: { y: ROW_GAP },
          open: { transition, y: 0 },
        }}
      >
        {children}
      </motion.div>
      <ScrollPin hold={isPinned} target={ref} />
    </motion.div>
  );
}

/**
 * One turn: what the person sent, anchored where reading starts, then the work
 * and the reply. Each turn keeps its object until something in it moves, so a
 * token landing in the last reply redraws only the last turn.
 */
export const TurnView = memo(function TurnView({
  carriesOn,
  chatId,
  changes,
  hasCard,
  isCardAway,
  isLast,
  replyEnd,
  separator,
  sessionId,
  turn,
  waitsForStep,
}: {
  /** It continues the turn above it as one reply, so it sits as close as that turn's rows. */
  carriesOn: boolean;
  chatId: ChatId;
  /** What its message brought to the agent's project and workspace instructions. */
  changes: readonly InstructionsChange[] | undefined;
  /** Its card is the one up in the transcript (`workCardTurnOf`). */
  hasCard: boolean;
  /** That card is out of sight (`useIsCardAway`). */
  isCardAway: boolean;
  isLast: boolean;
  /** Its footer and card, when it is the last turn of its reply (`repliesOf`). */
  replyEnd: ReplyEnd | undefined;
  separator: ChatSeparator | undefined;
  sessionId: StoreId.Session;
  turn: Turn;
  /** Its message is waiting on a step still going in the turn above it. */
  waitsForStep: boolean;
}) {
  const floorRef = useWorkingFloor(turn.phase === "working", isCardAway);
  return (
    <>
      {turn.opener && (
        <MessageScrollerItem
          className="flex flex-col gap-1 pb-2"
          data-transcript-row={`message:${turn.id}`}
          messageId={turn.opener.message.id}
          scrollAnchor
        >
          {separator && <ChatSeparatorRow separator={separator} />}
          <OpenerView chatId={chatId} opener={turn.opener} />
          {changes && <InstructionsChangesNote changes={changes} />}
        </MessageScrollerItem>
      )}
      <MessageScrollerItem
        className="group/assistant-turn flex flex-col gap-2"
        ref={floorRef}
        style={carriesOn ? { marginTop: ROW_GAP - TURN_GAP } : undefined}
        {...(turn.opener ? {} : { messageId: turn.id })}
      >
        <TurnBody
          chatId={chatId}
          hasCard={hasCard}
          isCardAway={isCardAway}
          isLast={isLast}
          replyEnd={replyEnd}
          sessionId={sessionId}
          turn={turn}
          waitsForStep={waitsForStep}
        />
      </MessageScrollerItem>
    </>
  );
});

function OpenerView({
  chatId,
  opener,
}: {
  chatId: ChatId;
  opener: TurnOpener;
}) {
  const { chips, files, folders, fromChat, notes, seen, text } = opener;
  return (
    <div className="flex flex-col gap-1">
      {/* What went with the message, one row of the composer's own chips:
          what was beside the chat, then what was attached. */}
      {(seen !== undefined ||
        chips.length + folders.length + files.length > 0) && (
        <div
          className="flex w-full flex-wrap justify-end gap-1.5"
          data-slot="sent-with-message"
        >
          {seen && <SentChips chatId={chatId} chips={[seen]} isSeen />}
          <SentChips chatId={chatId} chips={chips} />
          <SentFolderChips folders={folders} />
          <SentFileChips chatId={chatId} files={files} />
        </div>
      )}
      {fromChat && <AssignmentBubble fromChat={fromChat} />}
      {text && <UserMessage part={text} />}
      {notes.map((part) => (
        <NoteRow chatId={chatId} key={part.metadata.id} part={part} />
      ))}
    </div>
  );
}

/** What the chat told a task: its words, not the person's, so gray and labeled. */
function AssignmentBubble({
  fromChat,
}: {
  fromChat: NonNullable<TurnOpener["fromChat"]>;
}) {
  return (
    <div className="group flex w-full flex-col items-end gap-1">
      <span className="pr-1 text-xs text-muted-foreground">
        {fromChat.kind === "assignment"
          ? "Assignment from the chat"
          : "From the chat"}
      </span>
      <MessageBubble text={fromChat.text} tone="chat" />
    </div>
  );
}

/**
 * What stands under a finished reply: its footer, and under the chat's last
 * reply the next messages the chat suggests, which keep the footer drawn
 * since their arrows line up under its copy button.
 */
function ReplyFoot({
  chatId,
  isLast,
  messages,
  onBranch,
}: Pick<
  ComponentProps<typeof AssistantMessagesFooter>,
  "chatId" | "messages" | "onBranch"
> & {
  isLast: boolean;
}) {
  const hasNextSteps = useHasNextSteps() && isLast;
  return (
    <>
      <AssistantMessagesFooter
        alwaysVisible={hasNextSteps}
        {...(chatId === undefined ? {} : { chatId })}
        messages={messages}
        onBranch={onBranch}
      />
      {hasNextSteps && <NextStepRows />}
    </>
  );
}

function TurnBody({
  chatId,
  hasCard,
  isCardAway,
  isLast,
  replyEnd,
  sessionId,
  turn,
  waitsForStep,
}: {
  chatId: ChatId;
  hasCard: boolean;
  isCardAway: boolean;
  isLast: boolean;
  replyEnd: ReplyEnd | undefined;
  sessionId: StoreId.Session;
  turn: Turn;
  waitsForStep: boolean;
}) {
  const isFolded = useIsFolded(turn);
  const [isOpened, setIsOpened] = useState(false);
  const isOpenedForFind = use(FoldsOpenedByFind).has(turn.id);
  const releaseAutoScroll = useReleaseAutoScroll();
  const { onBranch } = use(TranscriptActionsContext);
  // A branch carries the conversation through the reply's last message.
  const branchesAt = turn.inherited ? undefined : replyEnd?.replies.at(-1)?.id;
  // The card sits under the work it shows, whose working line it goes with,
  // and only while that work is the last thing in the turn: words after it
  // end it (`workCardOf`). While the next activity is held back, the card
  // stays under the last one showing, and moves down as the next opens; held
  // behind words still coming out, it waits to open with its own row.
  const heldFrom = useHeldFrom(turn, isFolded);
  const isHolding = heldFrom !== Number.POSITIVE_INFINITY;
  const shown = turn.rows.slice(0, heldFrom);
  const cardAt = shown.findLastIndex((row) => row.kind === "activity");
  const isUnderWords = shown
    .slice(cardAt + 1)
    .some((row) => row.kind === "text");
  const card =
    isFolded || !hasCard || isUnderWords ? undefined : workCardOf(turn);
  const cardOpens = useCardOpens(card !== undefined && !isCardAway);
  const pinnedRow = usePinnedRow(turn, isFolded);
  const rows = shown.flatMap((row, index) => {
    const out = [];
    if (isFolded && row.id === turn.foldLineAt) {
      out.push(
        <WorkedRow
          chatId={chatId}
          isOpened={isOpened || isOpenedForFind}
          key="worked"
          onToggle={() => {
            releaseAutoScroll();
            setIsOpened((opened) => !opened);
          }}
          turn={turn}
        />,
      );
    }
    if (!isFolded || !turn.foldedRowIds.has(row.id)) {
      const live =
        turn.live?.kind === "activity" && turn.live.activityId === row.id
          ? turn.live
          : undefined;
      out.push(
        // Words open in place as they come out, so only the other rows open.
        <FoldingRow
          id={row.id}
          isPinned={row.id === pinnedRow}
          key={row.id}
          opens={row.kind !== "text"}
        >
          <RowView
            chatId={chatId}
            isLive={live !== undefined}
            isLast={isLast}
            isNewest={isLast && index === turn.rows.length - 1}
            row={row}
            thought={live?.thought}
          />
        </FoldingRow>,
      );
      if (index === cardAt && card) {
        out.push(
          // One key among the rows, so going from under one activity to under
          // the next keeps it mounted, with its picture and its sweep going,
          // and moves it there in the frame the new activity arrives. It goes
          // at once as words end it, so they never start below it.
          <CardPresence
            className="ml-7"
            isAway={isCardAway}
            key="work-card"
            opens={cardOpens}
          >
            <WorkCardView
              card={card}
              isCurrent={turn.phase === "working"}
              sessionId={sessionId}
            />
          </CardPresence>,
        );
      }
    }
    return out;
  });
  return (
    <>
      <AnimatePresence custom={isFolded} initial={false}>
        {rows}
      </AnimatePresence>
      {waitsForStep && (
        <p className="-mt-1 pr-1 text-right text-xs text-muted-foreground">
          Read after this step
        </p>
      )}
      {turn.live?.kind === "thinking" && !waitsForStep && !isHolding && (
        <ThinkingRow
          since={turn.live.since}
          thought={
            turn.live.thought && (
              <StepDetail chatId={chatId} step={turn.live.thought} />
            )
          }
        />
      )}
      {turn.phase !== "working" && !isHolding && (
        <CommandCards sessionId={sessionId} turn={turn} />
      )}
      {replyEnd?.hasFooter && !isHolding && (
        <ReplyFoot
          chatId={chatId}
          isLast={isLast}
          messages={replyEnd.replies}
          onBranch={
            onBranch && branchesAt !== undefined
              ? () => onBranch(branchesAt)
              : undefined
          }
        />
      )}
      {replyEnd?.ratingCard && !isHolding && (
        <RatingCard chatId={chatId} part={replyEnd.ratingCard} />
      )}
      {turn.branchedFrom && <BranchedFromLine part={turn.branchedFrom} />}
    </>
  );
}

/**
 * The commands that outlasted this turn, under its reply: those still going and
 * those that ended after it. One that ended while the turn went on is part of
 * the work the reply already covers.
 */
function CommandCards({
  sessionId,
  turn,
}: {
  sessionId: StoreId.Session;
  turn: Turn;
}) {
  const surface = use(TranscriptSurfaceContext);
  const commands = useTranscriptCommands();
  const endedAt = turn.endedAt?.getTime() ?? 0;
  const started = new Set(
    turn.rows.flatMap((row) =>
      row.kind === "activity"
        ? row.steps.flatMap((step) => step.processId ?? [])
        : [],
    ),
  );
  return commands
    .filter(
      (command) =>
        command.sessionId === sessionId &&
        started.has(command.id) &&
        (command.ranMs === undefined ||
          command.startedAt.getTime() + command.ranMs > endedAt),
    )
    .map((command) => (
      <CommandCard
        command={command}
        key={command.id}
        onStop={() => {
          surface?.onStopCommand(command);
        }}
      />
    ));
}

/**
 * Where the turn's rows stop for now, so nothing on screen moves because
 * something above it is still changing: after the first reply whose words are
 * still coming out, so a step, a card or Thinking never shows under words
 * still being written; and after a step that has just finished, while its
 * working line folds away, so what comes next opens below it once it is still
 * rather than sliding up behind it. The rest show once their row is done,
 * which the stage keeps a fraction of a second behind the stream. Any turn may
 * still be writing: a message sent mid-turn or a wake turn makes another turn
 * the last while the one before finishes its words.
 *
 * Replies held back are pointed at their text as it grows, waiting, so their
 * words start coming out when they show rather than appearing at once. Once
 * the turn folds, what the Worked row stands for is never drawn, so it holds
 * nothing back: a reply waiting there would wait for good.
 */
function useHeldFrom(turn: Turn, isFolded: boolean): number {
  // Reads the stage's clock and points reveals while rendering, which a
  // memoized render would skip or answer from an earlier time.
  "use no memo";
  const stage = useStage();
  const isReduced = useReducedMotion();
  const { rows } = turn;
  const liveId =
    turn.live?.kind === "activity" ? turn.live.activityId : undefined;
  const settleKey = `settle:${turn.id}`;
  const foldMs = isReduced === true ? 0 : FOLD_TRANSITION.duration * 1000;
  // The step that last stopped working while it was the last row, and when on
  // the stage's clock: its working line is folding away until `foldMs` later.
  const [settle, setSettle] = useState<{
    after: number;
    count: number;
    ended?: { at: number; index: number };
    liveId?: string;
  }>({ after: -1, count: rows.length, liveId });
  // What this render reads: a change made here is read at once, since the
  // render carries on with the old state and a stale one holds the wrong rows.
  let current = settle;
  if (settle.liveId !== liveId || settle.count !== rows.length) {
    let { ended } = settle;
    if (settle.liveId !== undefined && settle.liveId !== liveId) {
      const index = rows.findIndex((row) => row.id === settle.liveId);
      ended =
        index !== -1 && index === settle.count - 1
          ? { at: stage.now(), index }
          : undefined;
    }
    // A task's card closes its live work once something comes after it.
    if (rows.length > settle.count && rows[settle.count - 1]?.kind === "task") {
      ended = { at: stage.now(), index: settle.count - 1 };
    }
    let { after } = settle;
    // Something new under a step still folding its line waits until it is
    // still, so it opens below it rather than sliding up behind it.
    if (ended && rows.length > ended.index + 1) {
      const left = ended.at + foldMs - stage.now();
      if (left > 0) {
        stage.hold(settleKey, left);
        after = ended.index;
      }
      ended = undefined;
    }
    current = { after, count: rows.length, ended, liveId };
    setSettle(current);
  }
  const texts = rows.flatMap((row, index) =>
    row.kind === "text" && !(isFolded && turn.foldedRowIds.has(row.id))
      ? [
          {
            id: row.part.metadata.id,
            index,
            isStreaming: row.part.state === "streaming",
            text: row.part.text,
          },
        ]
      : [],
  );
  const ids = [settleKey, ...texts.map((text) => text.id)].join(" ");
  const subscribe = useCallback(
    (listener: () => void) => {
      const leaves = ids
        .split(" ")
        .map((id) => stage.subscribeReveal(id, listener));
      return () => {
        for (const leave of leaves) {
          leave();
        }
      };
    },
    [ids, stage],
  );
  const heldFrom = useSyncExternalStore(subscribe, () => {
    const settling =
      !isFolded && current.after !== -1 && stage.isHeld(settleKey)
        ? current.after + 1
        : Number.POSITIVE_INFINITY;
    for (const text of texts) {
      if (text.index >= settling) {
        break;
      }
      // A reply the stage has not seen came whole, and shows whole.
      const cut = stage.cutOf(text.id);
      if (cut !== undefined && cut < text.text.length) {
        return text.index + 1;
      }
    }
    return settling;
  });
  for (const text of texts) {
    if (text.index >= heldFrom) {
      stage.setTarget(text.id, text.text, text.isStreaming, true);
    }
  }
  return heldFrom;
}

/** How long after a fold starts its rows have closed, with a few frames to spare. */
const FOLD_SETTLED_MS = FOLD_TRANSITION.duration * 1000 + 160;

/**
 * The row the scroller keeps still on screen while the turn folds: the answer,
 * the first row after the work the fold takes. It is held from the turn's end
 * until the fold has closed, so what folds above it scrolls away rather than
 * pulling it up from where it is being read. None for a turn first drawn
 * already folded, which never folds in front of the reader.
 */
function usePinnedRow(turn: Turn, isFolded: boolean): string | undefined {
  const [hasSeenWork] = useState(!isFolded);
  const [hasFolded, setHasFolded] = useState(false);
  useEffect(() => {
    if (!isFolded) {
      return;
    }
    const timer = window.setTimeout(() => {
      setHasFolded(true);
    }, FOLD_SETTLED_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isFolded]);
  const { endedAt, foldedRowIds, rows } = turn;
  if (
    !hasSeenWork ||
    hasFolded ||
    endedAt === undefined ||
    foldedRowIds.size === 0
  ) {
    return undefined;
  }
  const lastFolded = rows.findLastIndex((row) => foldedRowIds.has(row.id));
  return rows.slice(lastFolded + 1).find((row) => !foldedRowIds.has(row.id))
    ?.id;
}

/** Whether the turn is folded now, turning so when its wait for a summary runs out. */
function useIsFolded(turn: Turn): boolean {
  const foldsAt =
    turn.foldedRowIds.size > 0 && turn.endedAt
      ? turn.endedAt.getTime() + FOLD_WAIT_MS
      : undefined;
  const hasPassed = usePassed(foldsAt);
  return isTurnFolded(turn, hasPassed && foldsAt ? foldsAt : 0);
}

/**
 * "Thinking", and for how long, while no call is running. It waits a moment
 * before it shows and fades in, since the gaps between most of what an agent does
 * are too short to read, and then it stays until the row that follows it. A
 * model with words for what it is thinking can be opened to read them, for when
 * it has been at it a while.
 */
export function ThinkingRow({
  since,
  thought,
}: {
  since: Date;
  thought?: ReactNode;
}) {
  const now = useTicking(true);
  const isDue = usePassed(since.getTime() + THINKING_AFTER_MS);
  const [hasShown, setHasShown] = useState(isDue);
  const [isOpen, setIsOpen] = useState(false);
  const releaseAutoScroll = useReleaseAutoScroll();
  if (isDue && !hasShown) {
    setHasShown(true);
  }
  if (!hasShown) {
    return null;
  }
  return (
    <div className="animate-in duration-300 fade-in-0 motion-reduce:animate-none">
      <RowLine
        isLive
        isOpen={isOpen}
        label="Thinking"
        mark={<WorkingMark />}
        onClick={
          thought
            ? () => {
                releaseAutoScroll();
                setIsOpen((open) => !open);
              }
            : undefined
        }
        right={
          <>
            <MidDot />
            {formatClock(now - since.getTime())}
          </>
        }
      >
        {isOpen && thought && <div className="mt-1 ml-7">{thought}</div>}
      </RowLine>
    </div>
  );
}

/** A finished turn's work as one line, opening onto its rows. */
function WorkedRow({
  chatId,
  isOpened,
  onToggle,
  turn,
}: {
  chatId: ChatId;
  isOpened: boolean;
  onToggle: () => void;
  turn: Turn;
}) {
  const isReduced = useReducedMotion();
  const transition = isReduced ? { duration: 0 } : FOLD_TRANSITION;
  return (
    <motion.div
      animate={{
        height: "auto",
        marginTop: 0,
        opacity: 1,
        transitionEnd: { overflow: "visible" },
      }}
      className="min-w-0"
      data-transcript-row={`worked:${turn.id}`}
      initial={{
        height: 0,
        marginTop: -ROW_GAP,
        opacity: 0,
        overflow: "hidden",
      }}
      transition={transition}
    >
      <RowLine
        isOpen={isOpened}
        label={workedLine(turn)}
        mark={
          <span className="flex size-5 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
            <CheckIcon className="size-3 text-foreground/70" />
          </span>
        }
        onClick={onToggle}
        places={<Badges apps={turn.apps} sites={turn.sites} />}
        sweepsIn
      >
        <AnimatePresence initial={false}>
          {isOpened && (
            <motion.div
              animate={{
                height: "auto",
                opacity: 1,
                transitionEnd: { overflow: "visible" },
              }}
              exit={{ height: 0, opacity: 0, overflow: "hidden" }}
              initial={{ height: 0, opacity: 0, overflow: "hidden" }}
              transition={transition}
            >
              <div className="mt-1 ml-2.5 flex flex-col gap-1.5 border-l border-border pl-4">
                {turn.rows
                  .filter((row) => turn.foldedRowIds.has(row.id))
                  .map((row) => (
                    <div data-transcript-row={row.id} key={row.id}>
                      {row.kind === "activity" ? (
                        <FoldedActivityView chatId={chatId} row={row} />
                      ) : row.kind === "text" ? (
                        <FoldedWords chatId={chatId} part={row.part} />
                      ) : (
                        <RowView
                          chatId={chatId}
                          isLast={false}
                          isLive={false}
                          row={row}
                        />
                      )}
                    </div>
                  ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </RowLine>
    </motion.div>
  );
}

/**
 * What the agent said between steps, in an opened Worked row: at a step
 * label's size and from its edge, a shade stronger than a label, so the fold
 * reads as one list rather than replies between its rows.
 */
function FoldedWords({
  chatId,
  part,
}: {
  chatId: ChatId;
  part: SessionMessagePart.TextPart;
}) {
  return (
    <SessionMarkdown
      assetVersion={part.metadata.id}
      chatId={chatId}
      className="w-full py-1 pl-7 leading-5 opacity-80"
      markdown={part.text}
    />
  );
}

function RowView({
  chatId,
  isLast,
  isLive,
  isNewest = false,
  row,
  thought,
}: {
  chatId: ChatId;
  isLast: boolean;
  isLive: boolean;
  /** Nothing comes after it in the chat. */
  isNewest?: boolean;
  row: TurnRow;
  thought?: StepPart;
}) {
  const actions = use(TranscriptActionsContext);
  switch (row.kind) {
    case "activity": {
      return (
        <ActivityRowView
          chatId={chatId}
          isLive={isLive}
          row={row}
          thought={thought}
        />
      );
    }
    case "ask": {
      return <AskRow chatId={chatId} part={row.part} />;
    }
    case "error": {
      return (
        <MessageError
          chatId={chatId}
          compact
          draws={row.draws}
          isAgentRunning={isLast && actions.isRunning}
          isLastMessage={row.isLastMessage}
          isLatestAttempt={row.isLatestAttempt}
          message={row.message}
          onChooseModel={actions.onChooseModel}
          onModelChange={actions.onModelChange}
          onRunAgain={actions.onRunAgain}
        />
      );
    }
    case "note": {
      return row.part.type === "data-pageTakeover" ? (
        <PageTakeoverNote
          chatId={chatId}
          data={row.part.data}
          isNewest={isNewest}
        />
      ) : (
        <NoteRow chatId={chatId} part={row.part} />
      );
    }
    case "task": {
      return (
        <TaskCardRow
          {...(row.from && { from: row.from })}
          {...(row.name !== undefined && { name: row.name })}
          {...(row.sessionId && { sessionId: row.sessionId })}
          showsWork={isNewest}
          startedAt={row.startedAt}
        />
      );
    }
    case "text": {
      return (
        // As tall as the row it replaces, so the transcript does not shrink under
        // a message held at the top when Thinking gives way to a one-line reply.
        <div className="min-h-7" data-reply-row={row.part.metadata.id}>
          <AssistantMessage chatId={chatId} part={row.part} />
        </div>
      );
    }
  }
}

/** A question or a sign-in: its card, or a quiet line once answered and folded. */
function AskRow({
  chatId,
  part,
}: {
  chatId: ChatId;
  part: SessionMessagePart.ToolPart;
}) {
  const actions = use(TranscriptActionsContext);
  return <ToolCallBody chatId={chatId} onRetry={actions.onRetry} part={part} />;
}

/** A note the person reads. */
function NoteRow({
  chatId,
  part,
}: {
  chatId: ChatId;
  part: SessionMessagePart.DataPart;
}) {
  return renderDataPart(part, chatId);
}
