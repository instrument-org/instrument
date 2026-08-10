import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  browserStatusModelNote,
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
  type StoreId,
  type Task,
} from "@instrument-org/workspace/client";
import { WarningIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { getAssetBaseUrl } from "../lib/asset-base-url";
import { cn } from "../lib/utils";
import { AssistantMessagesFooter } from "./assistant-messages-footer";
import { AttachmentsCard } from "./attachments-card";
import {
  renderChatPart,
  type RenderPartContext,
} from "./chat-stream-render-part";
import { FolderAttachmentsCard } from "./folder-attachments-card";
import { PlanningDotIcon } from "./icons/planning-dot";
import { MessageError } from "./message-error";
import { GroupHeading } from "./message-part/group-heading";
import { GroupStandIn } from "./message-part/group-stand-in";
import {
  STEP_RUN,
  TRANSCRIPT_ROW,
  TranscriptGroup,
  TranscriptGroupHead,
} from "./message-part/transcript-group";
import { ProjectContextNote } from "./project-context-note";
import {
  buildTranscriptLayout,
  generatedGroupHeading,
  groupCanExpand,
  groupStandInRowId,
  isActiveToolPart,
  isVisibleAssistantPart,
  planRow,
  type TranscriptGroup as TranscriptGroupData,
  type TranscriptRow,
} from "./transcript-layout";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { MessageScrollerItem } from "./ui/message-scroller";
import { Wordmark } from "./wordmark";

// How far the rows a group holds sit inside its head line: one step in, enough
// that the indent reads at a glance without pushing the run away from the
// margin the rest of the transcript is set against.
const GROUP_INDENT = "pl-6";

// The wordmark's row key, for the one case where it is not a message's own
// chrome but a row in the turn that has not started yet.
const TURN_WORDMARK_ID = "turn-wordmark";

// The initial row has no message part of its own, so it needs a stable key as
// empty assistant messages arrive before the first visible part.
const PLANNING_ROW_ID = "planning";

// What the agent said, held apart from what it did. 24px between a paragraph
// and a run of steps rather than the 8px the transcript puts between rows, so
// two things that look alike -- one line of text, the same size, the same
// leading -- read as the different kinds of thing they are. Runs of steps stay
// 8px from each other: the boundary is prose, not every group edge.
//
// 16px on top of the 8px already there, and always on the lower of the two
// rows; see `hasProseBoundaryAbove` for why it can only be read that way.
const PROSE_GAP = "mt-4";

// The same 16px, as padding, for a run of steps opening under a paragraph. The
// group box's own -4px margin is what holds its steps on the rhythm, so a
// margin here would be resolved against it rather than added to it.
const PROSE_GAP_IN_GROUP = "pt-4";

interface AssistantMessageCheck {
  isDeveloperMode: boolean;
  isToolStreaming: (
    part: SessionMessagePart.ToolPart,
    message: SessionMessage.WithParts,
  ) => boolean;
  message: SessionMessage.AssistantWithParts;
}

interface ChatStreamProps {
  /**
   * Draw a finished turn's footer rather than revealing it on hover. For a
   * surface with no reader to hover it, where the row's height is real whether
   * or not anything is in it -- the playback page measures exactly that.
   */
  alwaysShowFooter?: boolean;
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  messages: SessionMessage.WithParts[];
  onContinue: () => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  /**
   * Hands scrolling back to the reader, called before the transcript grows
   * because they asked it to. The scroller cannot tell content a click opened
   * from output the agent produced, so without this it follows the growth and
   * takes the row out from under the pointer. Absent outside a scroller.
   */
  onReleaseAutoScroll?: () => void;
  onRetry: (prompt: string) => void;
  onStartNewTask: () => void;
  // Wrap each turn in a MessageScrollerItem so the transcript scroller can
  // anchor turns. Only the top-level transcript sets this; nested tool-agent
  // streams render flat.
  renderAsItems?: boolean;
  task: Task;
}

interface MessageRow {
  /** The group this row is drawn in; absent for rows outside one. */
  groupId?: StoreId.Part;
  /** See `TranscriptRow`; the group box reads it off the row it opens on. */
  hasProseBoundaryAbove?: boolean;
  /** The part it draws. Every row in the transcript is one. */
  id: StoreId.Part;
  /** Null once the fold has taken the row out; the row still holds its place. */
  node: React.ReactNode;
}

export function ChatStream({
  alwaysShowFooter = false,
  isAgentRunning,
  isDeveloperMode,
  messages,
  onContinue,
  onModelChange,
  onReleaseAutoScroll,
  onRetry,
  onStartNewTask,
  renderAsItems = false,
  task,
}: ChatStreamProps) {
  const assetBaseUrl = getAssetBaseUrl(task.id);

  // Every group starts closed, a reopened task included: what a finished task
  // did is a list of the phases it went through, and the steps inside a phase
  // are there for the reader who asks for them.
  const [expandedGroupIds, setExpandedGroupIds] = useState<
    ReadonlySet<StoreId.Part>
  >(() => new Set());

  const toggleGroup = (groupId: StoreId.Part) => {
    // Before the state change, so the scroller is already out of follow when
    // the rows it opens are measured.
    onReleaseAutoScroll?.();
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (!next.delete(groupId)) {
        next.add(groupId);
      }
      return next;
    });
  };

  const isGroupExpanded = (group: TranscriptGroupData | undefined) =>
    group !== undefined && expandedGroupIds.has(group.id);

  // The prompts the session was seeded with belong to the debug chat dialog,
  // not the transcript.
  const regularMessages = messages.filter(
    (message) => message.role !== "session-context",
  );

  const lastMessageId = regularMessages.at(-1)?.id;
  const lastRegularMessage = regularMessages.at(-1);
  const lastAssistantMessage =
    lastRegularMessage?.role === "assistant" ? lastRegularMessage : undefined;

  const isToolStreaming = (
    part: SessionMessagePart.ToolPart,
    message: SessionMessage.WithParts,
  ) => isAgentRunning && lastMessageId === message.id && isActiveToolPart(part);

  const lastAssistantMessageHasVisibleParts =
    lastAssistantMessage !== undefined &&
    hasVisibleAssistantParts({
      isDeveloperMode,
      isToolStreaming,
      message: lastAssistantMessage,
    });

  const { isAwaitingFirstRow, wordmarkMessageIds } = readTurnOpenings({
    isAgentRunning,
    isDeveloperMode,
    isToolStreaming,
    regularMessages,
  });

  // Precomputed over the whole transcript, since a group and the run edges
  // around it both cross message boundaries.
  const layout = buildTranscriptLayout({
    isAgentRunning,
    isDeveloperMode,
    isToolStreaming,
    regularMessages,
  });

  const renderCtx: RenderPartContext = {
    assetBaseUrl,
    isAgentRunning,
    isDeveloperMode,
    isToolStreaming,
    lastMessageId,
    onRetry,
    task,
  };

  // A group's head line copies the step the agent is on, which lives in some
  // later message than the one the group opens in. Rendering it means reaching
  // for a part by id rather than by where the loop below has got to.
  const partsById = new Map<
    StoreId.Part,
    {
      message: SessionMessage.WithParts;
      part: SessionMessagePart.Type;
      partIndex: number;
    }
  >();
  for (const message of regularMessages) {
    for (const [partIndex, part] of message.parts.entries()) {
      partsById.set(part.metadata.id, { message, part, partIndex });
    }
  }

  const renderStandIn = (group: TranscriptGroupData): React.ReactNode => {
    const rowId = groupStandInRowId({
      group,
      isExpanded: isGroupExpanded(group),
    });
    if (rowId === undefined) {
      return null;
    }

    const found = partsById.get(rowId);
    if (!found) {
      return null;
    }
    const node = renderChatPart({
      browserStatusContextAdded: false,
      ctx: renderCtx,
      isGroupWorking: true,
      isStandIn: true,
      message: found.message,
      part: found.part,
      partIndex: found.partIndex,
    });
    if (!node) {
      return null;
    }

    // The slot is what moves from one step to the next, so it wraps the copy
    // rather than the other way round: it stays put while the row inside it
    // is replaced.
    const slot = <GroupStandIn rowId={rowId}>{node}</GroupStandIn>;

    // Under a heading the copy is one of the group's rows and sits where they
    // sit. With no heading it is the head line itself, so it takes the outer
    // edge and answers the clicks that open and close the group.
    return group.headingRowId === undefined ? (
      <TranscriptGroupHead key="stand-in">{slot}</TranscriptGroupHead>
    ) : (
      <div className={GROUP_INDENT} key="stand-in">
        {slot}
      </div>
    );
  };

  const chatElements = buildChatElements();

  function buildChatElements() {
    const elements: React.ReactNode[] = [];
    let lastFooterIndex = 0;
    let previousBrowserStatusNote: string | undefined;
    let visibleAssistantContentCount = 0;

    for (const [messageIndex, message] of regularMessages.entries()) {
      const messageRows: MessageRow[] = [];

      const nextMessage = regularMessages[messageIndex + 1];
      const isLastInConsecutiveAssistantGroup =
        message.role === "assistant" && nextMessage?.role !== "assistant";
      const isLastMessage = messageIndex === regularMessages.length - 1;

      // Attachments are hoisted into per-message chrome below.
      const fileAttachments: SessionMessagePart.Type[] = [];
      let projectContextPart: SessionMessagePart.DataPart | undefined;
      const seenSourceIds = new Set<string>();

      for (const [partIndex, part] of message.parts.entries()) {
        let browserStatusContextAdded = false;
        if (part.type === "data-browserStatus") {
          const note = browserStatusModelNote(part.data);
          browserStatusContextAdded = note !== previousBrowserStatusNote;
          previousBrowserStatusNote = note;
        }

        if (part.type === "source-document" || part.type === "source-url") {
          if (seenSourceIds.has(part.sourceId)) {
            continue;
          }
          seenSourceIds.add(part.sourceId);
          continue;
        }

        if (message.role === "user" && part.type === "data-attachments") {
          fileAttachments.push(part);
          continue;
        }

        if (message.role === "user" && part.type === "data-projectContext") {
          projectContextPart = part;
          continue;
        }

        const rowId = part.metadata.id;
        const row = layout.rows.get(rowId);
        const group =
          row?.groupId === undefined
            ? undefined
            : layout.groups.get(row.groupId);
        const { isHidden, isIndented } = planRow({
          group,
          isExpanded: isGroupExpanded(group),
          row,
        });
        // A folded row still takes its place in the run, so the group it
        // belongs to is drawn even when everything in it is folded away. It is
        // not rendered, and does not count as something the turn said.
        if (isHidden) {
          messageRows.push({
            groupId: row?.groupId,
            hasProseBoundaryAbove: row?.hasProseBoundaryAbove,
            id: rowId,
            node: null,
          });
          continue;
        }

        const node = renderChatPart({
          browserStatusContextAdded,
          ctx: renderCtx,
          isGroupWorking: group?.phase === "working",
          message,
          part,
          partIndex,
        });
        if (!node) {
          continue;
        }

        messageRows.push({
          groupId: row?.groupId,
          hasProseBoundaryAbove: row?.hasProseBoundaryAbove,
          id: rowId,
          node: wrapRow({ isIndented, key: rowId, node, row }),
        });

        if (message.role === "assistant") {
          visibleAssistantContentCount++;
        }
      }

      const messageElements = collectGroups({
        groups: layout.groups,
        isGroupExpanded,
        onToggle: toggleGroup,
        renderStandIn,
        rows: messageRows,
      });

      // --- Per-message chrome ---

      if (wordmarkMessageIds.has(message.id)) {
        messageElements.unshift(
          <TurnWordmark key={`assistant-header-${message.id}`} />,
        );
      }

      if (message.role === "user") {
        const fileAttachmentsPart = fileAttachments.find(
          (part) => part.type === "data-attachments",
        );
        const attachmentsData =
          fileAttachmentsPart?.type === "data-attachments"
            ? fileAttachmentsPart.data
            : undefined;

        // Folders auto-included from the project are split out by their source
        // and shown in a slim "from project" note instead of the hand-attached
        // card.
        const projectData =
          projectContextPart?.type === "data-projectContext"
            ? projectContextPart.data
            : undefined;
        const allFolders = attachmentsData?.folders ?? [];
        const userFolders = allFolders.filter(
          (folder) => folder.source !== "project",
        );
        const projectFolders = allFolders.filter(
          (folder) => folder.source === "project",
        );
        const files = attachmentsData?.files ?? [];

        if (files.length > 0) {
          messageElements.unshift(
            <AttachmentsCard
              assetBaseUrl={assetBaseUrl}
              files={files}
              key={`attachments-${message.id}`}
              taskId={task.id}
            />,
          );
        }

        // Above the files, matching the composer, where the folder tray sits
        // over the prompt and its attachments.
        if (userFolders.length > 0) {
          messageElements.unshift(
            <FolderAttachmentsCard
              folders={userFolders}
              key={`folders-${message.id}`}
            />,
          );
        }

        if (projectData) {
          messageElements.unshift(
            <ProjectContextNote
              data={projectData}
              folders={projectFolders}
              key={`project-context-${message.id}`}
            />,
          );
        }
      }

      if (message.role === "assistant" && message.metadata.error) {
        messageElements.push(
          <MessageError
            isAgentRunning={isAgentRunning}
            isDeveloperMode={isDeveloperMode}
            isLastMessage={isLastMessage}
            key={`error-${message.id}`}
            message={message}
            onContinue={onContinue}
            onModelChange={onModelChange}
            onRetry={onRetry}
            onStartNewTask={onStartNewTask}
          />,
        );
      }

      if (isLastInConsecutiveAssistantGroup) {
        const assistantMessages = regularMessages
          .slice(lastFooterIndex, messageIndex + 1)
          .filter((m) => m.role === "assistant");

        // A group with nothing in it has no footer at all. One with something in
        // it always has the row, finished or not: whether the turn is still
        // being written decides what the row shows, not whether it is there.
        //
        // Which matters because "the turn is still being written" is settled by
        // the session's status and the transcript's messages arriving from two
        // different live queries, in either order. For the frames where they
        // disagree the answer here is wrong, and the whole point of reserving
        // the height is that being wrong costs nothing.
        const hasFooter =
          assistantMessages.length > 0 && visibleAssistantContentCount > 0;

        if (hasFooter) {
          messageElements.push(
            <AssistantMessagesFooter
              alwaysVisible={alwaysShowFooter}
              id={task.id}
              isTurnLive={
                isLastMessage &&
                (isAgentRunning || !lastAssistantMessageHasVisibleParts)
              }
              key={`assistant-footer-${message.id}`}
              messages={assistantMessages}
            />,
          );
        }

        lastFooterIndex = messageIndex + 1;
        visibleAssistantContentCount = 0;
      }

      if (renderAsItems) {
        if (messageElements.length > 0) {
          // The user's message is where a turn starts, and it is the one row per
          // turn that says so: the agent's side arrives as a message per step.
          // Anchoring it moves it to the reading line on arrival and holds it
          // there while the reply grows into the room the scroller reserves
          // below, so the column stops moving under whatever is being read.
          elements.push(
            <MessageScrollerItem
              className="flex flex-col gap-2"
              key={message.id}
              messageId={message.id}
              scrollAnchor={message.role === "user"}
            >
              {messageElements}
            </MessageScrollerItem>,
          );
        }
      } else {
        elements.push(...messageElements);
      }
    }

    // A turn opens the moment the user sends, before there is a visible part to
    // hang either of these on -- and the agent's first message can arrive empty,
    // so the window outlasts it. Drawn at the tail they keep one identity across
    // that whole window, and the first real row replaces the planning line in a
    // single step rather than fading a second copy in beneath it.
    if (isAwaitingFirstRow) {
      const initialRows = [
        <TurnWordmark key={TURN_WORDMARK_ID} />,
        <AwaitingFirstRow key={PLANNING_ROW_ID} />,
      ];
      elements.push(
        renderAsItems ? (
          <MessageScrollerItem
            className="flex flex-col gap-2"
            key={TURN_WORDMARK_ID}
          >
            {initialRows}
          </MessageScrollerItem>
        ) : (
          initialRows
        ),
      );
    }

    return elements;
  }

  const lastMessage = messages.at(-1);
  const shouldShowContinueButton =
    !isAgentRunning &&
    lastMessage?.role === "assistant" &&
    lastMessage.metadata.finishReason === "max-steps";

  const continueNode = shouldShowContinueButton ? (
    <Alert className="mt-4" variant="warning">
      <WarningIcon />
      <AlertDescription className="flex flex-col gap-3">
        <div className="text-xs">
          Agent was stopped due to reaching maximum unattended steps.
        </div>
        <Button onClick={onContinue} size="sm" variant="secondary">
          Resume the agent
        </Button>
      </AlertDescription>
    </Alert>
  ) : null;

  // Scroller mode emits direct children of MessageScrollerContent: each turn is
  // an anchorable item, and the surrounding chrome is wrapped so the scroller
  // still measures clean top-level rows.
  if (renderAsItems) {
    return (
      <>
        {chatElements}
        {continueNode && (
          <MessageScrollerItem key="continue">
            {continueNode}
          </MessageScrollerItem>
        )}
      </>
    );
  }

  return (
    <div
      className={cn(
        "group/assistant-message-footer",
        "flex w-full flex-col gap-2",
      )}
    >
      <div className="flex flex-col gap-2">{chatElements}</div>
      {continueNode}
    </div>
  );
}

// Whether the turn this message belongs to has anything to show for itself:
// the above, plus the one thing a message can show that is not one of its parts.
//
// The error row counts, since a turn that failed did produce something the user
// can see. An abort does not: it draws nothing outside developer mode, and a
// turn stopped before it started is one the user is looking away from already.
function assistantMessageHasContent({
  isDeveloperMode,
  isToolStreaming,
  message,
}: AssistantMessageCheck) {
  const error = message.metadata.error;
  if (error && (isDeveloperMode || error.kind !== "aborted")) {
    return true;
  }
  return hasVisibleAssistantParts({
    isDeveloperMode,
    isToolStreaming,
    message,
  });
}

/**
 * The turn is running and has nothing to show for it yet.
 *
 * The one row in the transcript with no part behind it, so it is built here
 * rather than through `renderChatPart`. It still takes `TRANSCRIPT_ROW` inside
 * `STEP_RUN`, because the first real row will replace it in the same place and
 * a row that is 4px off is a transcript that lifts as the agent starts working.
 */
function AwaitingFirstRow() {
  return (
    <div className={STEP_RUN}>
      <div className={cn(TRANSCRIPT_ROW, "animate-in fill-mode-both fade-in")}>
        <PlanningDotIcon />
        <span className="brand-shiny-text text-sm">Planning</span>
      </div>
    </div>
  );
}

// Boxes each run of rows that share a group, leaving everything else where it
// was. Adjacency is all it takes: the layout pass has already worked out which
// group each row belongs to, so a box is the stretch of rows answering to the
// same id.
//
// A turn is one message per step, so a group of any size reaches across several
// of them and this runs once per message over its share. Everything the box
// decides therefore comes off the group -- whether it can be opened, where its
// head line goes -- and never off the rows that happen to have landed on this
// side of a boundary. A folded group draws in the slice it opened in and nowhere
// else, which is what keeps it still while the agent works past it.
function collectGroups({
  groups,
  isGroupExpanded,
  onToggle,
  renderStandIn,
  rows,
}: {
  groups: Map<StoreId.Part, TranscriptGroupData>;
  isGroupExpanded: (group: TranscriptGroupData | undefined) => boolean;
  onToggle: (groupId: StoreId.Part) => void;
  renderStandIn: (group: TranscriptGroupData) => React.ReactNode;
  rows: MessageRow[];
}): React.ReactNode[] {
  const runs: { groupId?: StoreId.Part; rows: MessageRow[] }[] = [];
  for (const row of rows) {
    const current = runs.at(-1);
    if (current && current.groupId === row.groupId) {
      current.rows.push(row);
    } else {
      runs.push({ groupId: row.groupId, rows: [row] });
    }
  }

  return runs.flatMap((run) => {
    const group =
      run.groupId === undefined ? undefined : groups.get(run.groupId);
    const nodes = run.rows.map((row) => row.node).filter(Boolean);
    if (!group) {
      return nodes;
    }

    // Both belong to the slice the group opens on, or they would be drawn again
    // for every message the group runs through. That is also the only place the
    // copy of the step in flight can hold still, since it is the one row of the
    // group that is on screen for the whole of its life.
    const openingRow = run.rows.find((row) => row.id === group.id);
    const isOpeningSlice = openingRow !== undefined;
    const heading = isOpeningSlice ? generatedGroupHeading(group) : undefined;
    const standIn = isOpeningSlice ? renderStandIn(group) : null;

    // With the group folded, a middle slice holds nothing that draws, and an
    // empty box is a blank gap down the transcript where the steps used to be.
    if (nodes.length === 0 && heading === undefined && standIn === null) {
      return [];
    }

    // With a heading over it the copy of the step in flight is one of the
    // group's rows and follows them; with no heading it is the head line and
    // leads.
    const standsAtHead = group.headingRowId === undefined;

    return (
      <TranscriptGroup
        canExpand={groupCanExpand(group)}
        className={cn(
          openingRow?.hasProseBoundaryAbove === true && PROSE_GAP_IN_GROUP,
        )}
        isExpanded={isGroupExpanded(group)}
        key={`group-${group.id}-${run.rows[0]?.id ?? ""}`}
        onToggle={() => {
          onToggle(group.id);
        }}
      >
        {heading !== undefined && (
          <GroupHeading key="heading" title={heading} />
        )}
        {standsAtHead && standIn}
        {nodes}
        {!standsAtHead && standIn}
      </TranscriptGroup>
    );
  });
}

/**
 * Whether the message holds a part that draws a row.
 *
 * Not the same question as how many rows the transcript loop went on to emit
 * for it. That is a count of what was drawn, and the fold sits between the two:
 * a settled group keeps its rows and shows one of them. This is about the parts.
 */
function hasVisibleAssistantParts({
  isDeveloperMode,
  isToolStreaming,
  message,
}: AssistantMessageCheck) {
  return message.parts.some((part) =>
    isVisibleAssistantPart({
      isDeveloperMode,
      isStreaming: isToolPart(part) ? isToolStreaming(part, message) : false,
      part,
    }),
  );
}

/**
 * The assistant messages the wordmark heads: the ones that open a turn with
 * something in it, and the turn in flight whether or not it has anything yet.
 *
 * The wordmark is the anchor that says the agent has the message, so it comes up
 * the moment the turn is running rather than waiting for the first row to
 * arrive. A turn that ends with nothing to show keeps nothing -- an empty header
 * over a stack of user messages reads as a reply that failed to draw -- and the
 * only way to end a turn with nothing is to stop it before it started, which is
 * exactly the case where the user is looking at what they sent.
 *
 * Settled in one pass over the transcript rather than as the rows are built,
 * because a turn is one message per step: the wordmark goes on the message that
 * opens the turn, and whether the turn holds anything is not settled until the
 * last of them.
 */
function readTurnOpenings({
  isAgentRunning,
  isDeveloperMode,
  isToolStreaming,
  regularMessages,
}: Omit<AssistantMessageCheck, "message"> & {
  isAgentRunning: boolean;
  regularMessages: SessionMessage.WithParts[];
}) {
  const wordmarkMessageIds = new Set<StoreId.Message>();
  let openedBy: SessionMessage.WithParts | undefined;
  let hasContent = false;
  const close = () => {
    if (openedBy && hasContent) {
      wordmarkMessageIds.add(openedBy.id);
    }
    const closed = hasContent;
    openedBy = undefined;
    hasContent = false;
    return closed;
  };

  for (const message of regularMessages) {
    if (message.role !== "assistant") {
      close();
      continue;
    }
    openedBy ??= message;
    hasContent ||= assistantMessageHasContent({
      isDeveloperMode,
      isToolStreaming,
      message,
    });
  }
  const trailingTurnHasContent = close();

  // The one turn that gets a wordmark without having earned it, which is why
  // `close` above can ask only whether a turn produced something. It is drawn
  // at the tail rather than on a message, so it is deliberately not in the set.
  const isAwaitingFirstRow =
    isAgentRunning && regularMessages.length > 0 && !trailingTurnHasContent;

  return { isAwaitingFirstRow, wordmarkMessageIds };
}

// What opens an assistant turn, wherever the turn is opening from.
function TurnWordmark() {
  return (
    <div className="flex justify-start">
      <Wordmark className="mt-5 mb-2 h-5.5 text-black/30 dark:text-white/30" />
    </div>
  );
}

// The wrapper a row sits in.
//
// A group's steps are indented under its head line. Nothing else in the box is,
// and prose is never in one at all: see `planRow`.
//
// No vertical margins inside a group box. The 8px rhythm there is the box's job
// (see `TranscriptGroup`), and it only works if every row in it is the same
// height it looks: a step already carries 4px of padding for its click target,
// so anything in the box that is not a step is padded to match. The one margin
// is `PROSE_GAP`, which a paragraph takes at the margin of the transcript, where
// no box is holding the rhythm.
function wrapRow({
  isIndented,
  key,
  node,
  row,
}: {
  isIndented: boolean;
  key: string;
  node: React.ReactNode;
  row: TranscriptRow | undefined;
}): React.ReactNode {
  const needsRowPadding = row?.groupId !== undefined && row.kind !== "step";
  // A row inside a group takes the gap from the box around it, or the two would
  // both open it and the boundary would be twice as wide as it asks for.
  const needsProseGap =
    row?.hasProseBoundaryAbove === true && row.groupId === undefined;
  if (!isIndented && !needsRowPadding && !needsProseGap) {
    return node;
  }
  return (
    <div
      className={cn(
        isIndented && GROUP_INDENT,
        needsRowPadding && "py-1",
        needsProseGap && PROSE_GAP,
      )}
      key={`run-row-${key}`}
    >
      {node}
    </div>
  );
}
