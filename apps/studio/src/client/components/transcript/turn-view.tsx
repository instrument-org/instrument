import { type ChatSeparator } from "@/client/lib/chat-separators";
import { workedLine } from "@/client/lib/worked-line";
import { cn } from "@/client/lib/utils";
import {
  type ChatInfo,
  FOLD_WAIT_MS,
  isTurnFolded,
  slotOf,
  type SessionMessagePart,
  type StepPart,
  type StoreId,
  type Turn,
  type TurnOpener,
  type TurnRow,
} from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import { memo, type ReactNode, use, useState } from "react";

import { AssistantMessage } from "../assistant-message";
import { AssistantMessagesFooter } from "../assistant-messages-footer";
import { SentFileChips } from "../sent-file-chips";
import { CommandCard } from "../task/command-card";
import { ChatSeparatorRow } from "../chat-separator";
import { WorkingMark } from "../icons/working-mark";
import { MessageError } from "../message-error";
import { RatingCard } from "../message-part/rating-card";
import { ToolCallBody } from "../message-part/tool-call";
import { SentFolderChips } from "../sent-folder-chips";
import { useReleaseAutoScroll } from "../transcript-scroll-context";
import { MessageScrollerItem } from "../ui/message-scroller";
import { UserMessage } from "../user-message";
import { SentChips } from "../window/context-chip";
import { ActivityRowView, Badges, RowLine, StepDetail } from "./activity-row";
import { renderDataPart } from "./note-part";
import { SlotCardView } from "./slot-card";
import { TranscriptSurfaceContext } from "./surface";
import { TranscriptActionsContext } from "./transcript-actions";
import { TaskCardRow } from "./task-card";
import { formatClock, usePassed, useTicking } from "./time";

/** How long the work takes to close into its one line, so the reply slides up to it. */
const FOLD_TRANSITION = { duration: 0.24, ease: [0.32, 0.72, 0, 1] } as const;
/** The gap between a turn's rows, which a row closing takes with it. */
const ROW_GAP = 8;

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
 * The card, under the newest activity. It has one key among the rows, so going
 * from under one activity to under the next keeps it mounted, with its picture
 * and its sweep going. `AnimatePresence` holds a row that left until the next
 * commit, and this one draws nothing from the render that took it away, so it
 * goes in the same frame as the words that end it and they never start below it.
 */
function SlotRow({ children }: { children: ReactNode }) {
  return useIsPresent() ? <div className="ml-7">{children}</div> : null;
}

/**
 * One turn: what the person sent, anchored where reading starts, then the work
 * and the reply. Each turn keeps its object until something in it moves, so a
 * token landing in the last reply redraws only the last turn.
 */
export const TurnView = memo(function TurnView({
  chatInfo,
  isLast,
  separator,
  sessionId,
  turn,
  waitsForStep,
}: {
  chatInfo: ChatInfo;
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
          <OpenerView chatInfo={chatInfo} opener={turn.opener} />
        </MessageScrollerItem>
      )}
      <MessageScrollerItem
        className="group/assistant-turn flex flex-col gap-2"
        {...(turn.opener ? {} : { messageId: turn.id })}
      >
        <TurnBody
          chatInfo={chatInfo}
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
  chatInfo,
  opener,
}: {
  chatInfo: ChatInfo;
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
          <SentFileChips chatId={chatInfo.id} files={files} />
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

/** How many lines of an assignment show before Show all, by its breaks and by its length. */
const ASSIGNMENT_LINES = 6;
const ASSIGNMENT_CHARS = 360;

/** What the chat told a task: its words, not the person's, so gray and labeled. */
function AssignmentBubble({
  fromChat,
}: {
  fromChat: NonNullable<TurnOpener["fromChat"]>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isLong =
    fromChat.text.length > ASSIGNMENT_CHARS ||
    fromChat.text.split("\n").length > ASSIGNMENT_LINES;
  return (
    <div className="ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1">
      <span className="pr-1 text-xs text-muted-foreground">
        {fromChat.kind === "assignment"
          ? "Assignment from the chat"
          : "From the chat"}
      </span>
      <div className="flex flex-col gap-1 rounded-2xl bg-muted px-3.5 py-2.5 text-sm">
        <p
          className={cn(
            "whitespace-pre-wrap",
            isLong && !isOpen && "line-clamp-6",
          )}
        >
          {fromChat.text}
        </p>
        {isLong && (
          <button
            className="w-fit text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setIsOpen((open) => !open);
            }}
            type="button"
          >
            {isOpen ? "Show less" : "Show all"}
          </button>
        )}
      </div>
    </div>
  );
}

function TurnBody({
  chatInfo,
  isLast,
  sessionId,
  turn,
  waitsForStep,
}: {
  chatInfo: ChatInfo;
  isLast: boolean;
  sessionId: StoreId.Session;
  turn: Turn;
  waitsForStep: boolean;
}) {
  const isFolded = useIsFolded(turn);
  const [isOpened, setIsOpened] = useState(false);
  const releaseAutoScroll = useReleaseAutoScroll();
  const card = isFolded ? undefined : slotOf(turn);
  const lastWork = turn.rows.findLastIndex((row) => row.kind === "activity");
  const rows = turn.rows.flatMap((row, index) => {
    const out = [];
    if (isFolded && row.id === turn.foldLineAt) {
      out.push(
        <WorkedRow
          chatInfo={chatInfo}
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
            chatInfo={chatInfo}
            isLive={live !== undefined}
            isLast={isLast}
            row={row}
            thought={live?.thought}
          />
        </FoldingRow>,
      );
      if (index === lastWork && card) {
        out.push(
          <SlotRow key="slot-card">
            <SlotCardView
              card={card}
              isCurrent={turn.phase === "working"}
              sessionId={sessionId}
            />
          </SlotRow>,
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
              <StepDetail chatInfo={chatInfo} step={turn.live.thought} />
            )
          }
        />
      )}
      {turn.phase !== "working" && (
        <CommandCards sessionId={sessionId} turn={turn} />
      )}
      {turn.phase !== "working" && hasReply && turn.replies.length > 0 && (
        <AssistantMessagesFooter messages={turn.replies} />
      )}
      {turn.ratingCard && (
        <RatingCard chatId={chatInfo.id} part={turn.ratingCard} />
      )}
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
  const commands = surface?.useCommands() ?? [];
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
    turn.foldsWhenDone && turn.endedAt
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
  chatInfo,
  isOpened,
  onToggle,
  turn,
}: {
  chatInfo: ChatInfo;
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
        rollKey={workedLine(turn)}
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
                      <RowView
                        chatInfo={chatInfo}
                        isLast={false}
                        isLive={false}
                        row={row}
                      />
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
  chatInfo,
  isLast,
  isLive,
  row,
  thought,
}: {
  chatInfo: ChatInfo;
  isLast: boolean;
  isLive: boolean;
  row: TurnRow;
  thought?: StepPart;
}) {
  const actions = use(TranscriptActionsContext);
  switch (row.kind) {
    case "activity": {
      return (
        <ActivityRowView
          chatInfo={chatInfo}
          isLive={isLive}
          row={row}
          thought={thought}
        />
      );
    }
    case "ask": {
      return <AskRow chatInfo={chatInfo} part={row.part} />;
    }
    case "error": {
      return (
        <MessageError
          chatId={chatInfo.id}
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
      return <NoteRow part={row.part} />;
    }
    case "task": {
      return (
        <TaskCardRow sessionId={row.sessionId} startedAt={row.startedAt} />
      );
    }
    case "text": {
      return (
        // As tall as the row it replaces, so the transcript does not shrink under
        // a message held at the top when Thinking gives way to a one-line reply.
        <div className="min-h-7" data-reply-row={row.part.metadata.id}>
          <AssistantMessage chatId={chatInfo.id} part={row.part} />
        </div>
      );
    }
  }
}

/** A question or a sign-in: its card, or a quiet line once answered and folded. */
function AskRow({
  chatInfo,
  part,
}: {
  chatInfo: ChatInfo;
  part: SessionMessagePart.ToolPart;
}) {
  const actions = use(TranscriptActionsContext);
  return (
    <ToolCallBody chatInfo={chatInfo} onRetry={actions.onRetry} part={part} />
  );
}

/** A note the person reads. */
function NoteRow({ part }: { part: SessionMessagePart.DataPart }) {
  return renderDataPart(part);
}
