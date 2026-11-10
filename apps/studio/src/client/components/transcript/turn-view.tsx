import { type ChatSeparator } from "@/client/lib/chat-separators";
import { type InstructionsChange } from "@/client/lib/instructions-changes";
import { workedLine } from "@/client/lib/worked-line";
import {
  type ChatId,
  FOLD_WAIT_MS,
  isTurnFolded,
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
  useState,
} from "react";

import { AssistantMessage } from "../assistant-message";
import { AssistantMessagesFooter } from "../assistant-messages-footer";
import { SentFileChips } from "../sent-file-chips";
import { CommandCard } from "../task/command-card";
import { ChatSeparatorRow } from "../chat-separator";
import { InstructionsChangesNote } from "../instructions-changes-note";
import { WorkingMark } from "../icons/working-mark";
import { MessageError } from "../message-error";
import { RatingCard } from "../message-part/rating-card";
import { ToolCallBody } from "../message-part/tool-call";
import { SentFolderChips } from "../sent-folder-chips";
import { useReleaseAutoScroll } from "../transcript-scroll-context";
import { MessageScrollerItem } from "../ui/message-scroller";
import { MessageBubble, UserMessage } from "../user-message";
import { SentChips } from "../window/context-chip";
import {
  CardPresence,
  FOLD_TRANSITION,
  ROW_GAP,
  useCardOpens,
} from "./card-motion";
import {
  ActivityRowView,
  Badges,
  FoldedActivityView,
  RowLine,
  StepDetail,
} from "./activity-row";
import { BranchedFromLine } from "./branched-from-line";
import { NextStepRows, useHasNextSteps } from "./next-steps";
import { renderDataPart } from "./note-part";
import { PageTakeoverNote } from "./page-takeover-note";
import { WorkCardView } from "./work-card";
import { TranscriptSurfaceContext } from "./surface";
import { useTranscriptCommands } from "./transcript-data";
import { TranscriptActionsContext } from "./transcript-actions";
import { TaskCardRow } from "./task-card";
import { formatClock, usePassed, useTicking } from "./time";
import { WakeLine } from "./wake-line";

/** How long the agent may sit between things before the transcript says it is thinking. */
const THINKING_AFTER_MS = 1000;

/**
 * A row that closes as the fold takes it, told by `AnimatePresence`'s `custom`.
 * A row leaving for any other reason just goes, or what is under it would slide
 * up for no reason the reader can see.
 */
function FoldingRow({ children, id }: { children: ReactNode; id: string }) {
  const isReduced = useReducedMotion();
  return (
    <motion.div
      className="flex min-w-0 flex-col gap-2 empty:hidden"
      data-transcript-row={id}
      exit="leaving"
      variants={{
        leaving: (isFolding: boolean) =>
          isFolding
            ? {
                height: 0,
                marginTop: -ROW_GAP,
                opacity: 0,
                overflow: "hidden",
                transition: isReduced ? { duration: 0 } : FOLD_TRANSITION,
              }
            : { opacity: 0, transition: { duration: 0 } },
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * One turn: what the person sent, anchored where reading starts, then the work
 * and the reply. Each turn keeps its object until something in it moves, so a
 * token landing in the last reply redraws only the last turn.
 */
export const TurnView = memo(function TurnView({
  chatId,
  changes,
  hasCard,
  isLast,
  separator,
  sessionId,
  turn,
  waitsForStep,
}: {
  chatId: ChatId;
  /** What its message brought to the agent's project and workspace instructions. */
  changes: readonly InstructionsChange[] | undefined;
  /** Its card is the one up in the transcript (`workCardTurnOf`). */
  hasCard: boolean;
  isLast: boolean;
  separator: ChatSeparator | undefined;
  sessionId: StoreId.Session;
  turn: Turn;
  /** Its message is waiting on a step still going in the turn above it. */
  waitsForStep: boolean;
}) {
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
        {...(turn.opener ? {} : { messageId: turn.id })}
      >
        {turn.wokenBy && <WakeLine woken={turn.wokenBy} />}
        <TurnBody
          chatId={chatId}
          hasCard={hasCard}
          isLast={isLast}
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
  const { chips, files, folders, fromChat, notes, text } = opener;
  return (
    <div className="flex flex-col gap-1">
      {/* What went with the message, one row of the composer's own chips:
          what was on screen, then the folders and files attached. */}
      {chips.length + folders.length + files.length > 0 && (
        <div
          className="flex w-full flex-wrap justify-end gap-1.5"
          data-slot="sent-with-message"
        >
          <SentChips chips={chips} />
          <SentFolderChips folders={folders} />
          <SentFileChips chatId={chatId} files={files} />
        </div>
      )}
      {fromChat && <AssignmentBubble fromChat={fromChat} />}
      {text && <UserMessage part={text} />}
      {notes.map((part) => (
        <NoteRow key={part.metadata.id} part={part} />
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
  isLast,
  messages,
  onBranch,
}: Pick<
  ComponentProps<typeof AssistantMessagesFooter>,
  "messages" | "onBranch"
> & {
  isLast: boolean;
}) {
  const hasNextSteps = useHasNextSteps() && isLast;
  return (
    <>
      <AssistantMessagesFooter
        alwaysVisible={hasNextSteps}
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
  isLast,
  sessionId,
  turn,
  waitsForStep,
}: {
  chatId: ChatId;
  hasCard: boolean;
  isLast: boolean;
  sessionId: StoreId.Session;
  turn: Turn;
  waitsForStep: boolean;
}) {
  const isFolded = useIsFolded(turn);
  const [isOpened, setIsOpened] = useState(false);
  const releaseAutoScroll = useReleaseAutoScroll();
  const { onBranch } = use(TranscriptActionsContext);
  // A branch carries the conversation through the reply's last message.
  const branchesAt = turn.inherited ? undefined : turn.replies.at(-1)?.id;
  const card = isFolded || !hasCard ? undefined : workCardOf(turn);
  const cardOpens = useCardOpens(card !== undefined);
  // The card sits under the work it shows, whose working line it goes with,
  // and never under words: what the agent says comes in below it, and the
  // next command it shows takes it down past them.
  const cardAt = turn.rows.findLastIndex((row) => row.kind === "activity");
  const rows = turn.rows.flatMap((row, index) => {
    const out = [];
    if (isFolded && row.id === turn.foldLineAt) {
      out.push(
        <WorkedRow
          chatId={chatId}
          isOpened={isOpened}
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
        <FoldingRow id={row.id} key={row.id}>
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
          // and moves it there in the frame the new activity arrives. It closes
          // with the fold and goes at once as words end it.
          <CardPresence className="ml-7" key="work-card" opens={cardOpens}>
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
  const hasReply =
    turn.rows.findLast((row) => row.kind !== "note")?.kind === "text";
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
      {turn.live?.kind === "thinking" && !waitsForStep && (
        <ThinkingRow
          since={turn.live.since}
          thought={
            turn.live.thought && (
              <StepDetail chatId={chatId} step={turn.live.thought} />
            )
          }
        />
      )}
      {turn.phase !== "working" && (
        <CommandCards sessionId={sessionId} turn={turn} />
      )}
      {turn.phase !== "working" && hasReply && turn.replies.length > 0 && (
        <ReplyFoot
          isLast={isLast}
          messages={turn.replies}
          onBranch={
            onBranch && branchesAt !== undefined
              ? () => onBranch(branchesAt)
              : undefined
          }
        />
      )}
      {turn.ratingCard && <RatingCard chatId={chatId} part={turn.ratingCard} />}
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
        right={`· ${formatClock(now - since.getTime())}`}
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
        <NoteRow part={row.part} />
      );
    }
    case "task": {
      return (
        <TaskCardRow
          {...(row.from && { from: row.from })}
          {...(row.name !== undefined && { name: row.name })}
          {...(row.sessionId && { sessionId: row.sessionId })}
          startedAt={row.startedAt}
        />
      );
    }
    case "text": {
      return (
        // As tall as the row it replaces, so the transcript does not shrink under
        // a message held at the top when Thinking gives way to a one-line reply.
        <div
          className="min-h-7"
          data-reply-row={row.part.metadata.id}
          data-reply-tail={isNewest || undefined}
        >
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
function NoteRow({ part }: { part: SessionMessagePart.DataPart }) {
  return renderDataPart(part);
}
