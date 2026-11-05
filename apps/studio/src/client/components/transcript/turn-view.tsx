import { type ChatSeparator } from "@/client/lib/chat-separators";
import { workedLine } from "@/client/lib/worked-line";
import { cn } from "@/client/lib/utils";
import {
  type ChatInfo,
  FOLD_WAIT_MS,
  isSlotBehind,
  isTurnFolded,
  slotOf,
  type SessionMessagePart,
  type StoreId,
  type Turn,
  type TurnOpener,
  type TurnRow,
} from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { memo, type ReactNode, use, useState } from "react";

import { AssistantMessage } from "../assistant-message";
import { AssistantMessagesFooter } from "../assistant-messages-footer";
import { AttachmentsCard } from "../attachments-card";
import { ChatSeparatorRow } from "../chat-separator";
import { PlanningDotIcon } from "../icons/planning-dot";
import { MessageError } from "../message-error";
import { ToolCallBody } from "../message-part/tool-call";
import { SentFoldersCard } from "../sent-folders-card";
import { useReleaseAutoScroll } from "../transcript-scroll-context";
import { MessageScrollerItem } from "../ui/message-scroller";
import { UserMessage } from "../user-message";
import { SentChips } from "../window/context-chip";
import { ActivityRowView, Badges, RowLine } from "./activity-row";
import { DeveloperNote } from "./developer-note";
import { renderDataPart } from "./note-part";
import { SlotCardView } from "./slot-card";
import {
  StateNotesContext,
  TranscriptActionsContext,
} from "./transcript-actions";
import { TaskCardRow } from "./task-card";
import { formatClock, usePassed, useTicking } from "./time";

/** How long the work takes to close into its one line, so the reply slides up to it. */
const FOLD_TRANSITION = { duration: 0.24, ease: [0.32, 0.72, 0, 1] } as const;
/** The gap between a turn's rows, which a row closing takes with it. */
const ROW_GAP = 8;

/** A row that closes as the fold takes it. */
function FoldingRow({ children }: { children: ReactNode }) {
  const isReduced = useReducedMotion();
  return (
    <motion.div
      className="min-w-0"
      exit={{ height: 0, marginTop: -ROW_GAP, opacity: 0, overflow: "hidden" }}
      transition={isReduced ? { duration: 0 } : FOLD_TRANSITION}
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
          className="flex flex-col gap-1"
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
      {chips.length > 0 && <SentChips chips={chips} />}
      {folders.length > 0 && <SentFoldersCard folders={folders} />}
      {files.length > 0 && (
        <AttachmentsCard chatId={chatInfo.id} files={files} />
      )}
      {fromChat && <AssignmentBubble fromChat={fromChat} />}
      {text && <UserMessage part={text} />}
      {notes.map((part) => (
        <NoteRow chatInfo={chatInfo} key={part.metadata.id} part={part} />
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
  const firstFolded = turn.rows.findIndex((row) =>
    turn.foldedRowIds.has(row.id),
  );
  const cardRow = card && (
    <SlotCardView
      card={card}
      isCurrent={!isSlotBehind(card, turn)}
      key="slot"
      sessionId={sessionId}
    />
  );
  const rows = turn.rows.flatMap((row, index) => {
    const out = [];
    if (isFolded && index === firstFolded) {
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
      out.push(
        <FoldingRow key={row.id}>
          <RowView
            chatInfo={chatInfo}
            isLive={
              turn.live?.kind === "activity" && turn.live.activityId === row.id
            }
            isLast={isLast}
            row={row}
          />
        </FoldingRow>,
      );
    }
    if (index === lastWork && cardRow) {
      out.push(cardRow);
    }
    return out;
  });
  const hasReply =
    turn.rows.findLast((row) => row.kind !== "note")?.kind === "text";
  return (
    <>
      <AnimatePresence initial={false}>{rows}</AnimatePresence>
      {waitsForStep && (
        <p className="-mt-1 pr-1 text-right text-xs text-muted-foreground">
          Read after this step
        </p>
      )}
      {turn.live?.kind === "thinking" && !waitsForStep && (
        <ThinkingRow since={turn.live.since} />
      )}
      {turn.phase !== "working" && hasReply && turn.replies.length > 0 && (
        <AssistantMessagesFooter messages={turn.replies} />
      )}
    </>
  );
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

/** "Thinking", and for how long, while no call is running. */
export function ThinkingRow({ since }: { since: Date }) {
  const now = useTicking(true);
  return (
    <RowLine
      isLive
      label="Thinking"
      mark={<PlanningDotIcon />}
      right={`· ${formatClock(now - since.getTime())}`}
    />
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
              <div className="mt-1 ml-2.5 flex flex-col gap-0.5 border-l border-border pl-4">
                {turn.rows
                  .filter(
                    (row) =>
                      turn.foldedRowIds.has(row.id) && row.kind !== "text",
                  )
                  .map((row) => (
                    <RowView
                      chatInfo={chatInfo}
                      isLast={false}
                      isLive={false}
                      key={row.id}
                      row={row}
                    />
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
}: {
  chatInfo: ChatInfo;
  isLast: boolean;
  isLive: boolean;
  row: TurnRow;
}) {
  const actions = use(TranscriptActionsContext);
  switch (row.kind) {
    case "activity": {
      return <ActivityRowView chatInfo={chatInfo} isLive={isLive} row={row} />;
    }
    case "ask": {
      return <AskRow chatInfo={chatInfo} part={row.part} />;
    }
    case "error": {
      return (
        <MessageError
          chatId={chatInfo.id}
          compact
          endedTurn={row.endedTurn}
          isAgentRunning={isLast && actions.isRunning}
          isDeveloperMode={actions.isDeveloperMode}
          isLastMessage={row.isLastMessage}
          message={row.message}
          onModelChange={actions.onModelChange}
          onRunAgain={actions.onRunAgain}
        />
      );
    }
    case "note": {
      return <NoteRow chatInfo={chatInfo} part={row.part} />;
    }
    case "task": {
      return (
        <TaskCardRow sessionId={row.sessionId} startedAt={row.startedAt} />
      );
    }
    case "text": {
      return (
        <div data-reply-row={row.part.metadata.id}>
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

/** A note everyone sees, or a developer's quiet line. */
function NoteRow({
  chatInfo,
  part,
}: {
  chatInfo: ChatInfo;
  part: SessionMessagePart.DataPart;
}) {
  const { isDeveloperMode } = use(TranscriptActionsContext);
  const stateNotes = use(StateNotesContext);
  const node = renderDataPart({
    ctx: { chatInfo, isDeveloperMode },
    part,
    stateNote: stateNotes.get(part.metadata.id),
  });
  if (node === null) {
    return null;
  }
  return <DeveloperNote part={part}>{node}</DeveloperNote>;
}
