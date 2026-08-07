import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  browserStatusModelNote,
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
  type Task,
} from "@instrument-org/workspace/client";
import { WarningIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getAssetBaseUrl } from "../lib/asset-base-url";
import { cn } from "../lib/utils";
import { AssistantMessagesFooter } from "./assistant-messages-footer";
import { AttachmentsCard } from "./attachments-card";
import {
  renderChatPart,
  type RenderPartContext,
} from "./chat-stream-render-part";
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
} from "./chat-stream-utils";
import { FolderAttachmentsCard } from "./folder-attachments-card";
import { MessageError } from "./message-error";
import { GroupHeading } from "./message-part/group-heading";
import {
  STEP_RUN,
  TranscriptGroup,
  TranscriptGroupHead,
} from "./message-part/transcript-group";
import { ProjectContextNote } from "./project-context-note";
import { ReasoningMessage } from "./reasoning-message";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { MessageScrollerItem } from "./ui/message-scroller";
import { Wordmark } from "./wordmark";

// After a streaming text part stops growing for this long, treat it as stalled
// so the planning loader can reappear beneath the otherwise-finished prose.
const STREAM_STALL_MS = 700;

// How far the rows a group holds sit inside its head line: one step in, enough
// that the indent reads at a glance without pushing the run away from the
// margin the rest of the transcript is set against.
const GROUP_INDENT = "pl-6";

// The wordmark's row key, for the one case where it is not a message's own
// chrome but a row in the turn that has not started yet.
const TURN_WORDMARK_ID = "turn-wordmark";

// The planning row's key. It is not a part, and belongs to no group: it says
// the agent is working with nothing to show for it yet.
const PLANNING_ROW_ID = "planning";

interface ChatStreamProps {
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  messages: SessionMessage.WithParts[];
  onContinue: () => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
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
  groupId?: string;
  /** The part id, or a synthetic key for a row that is not a part. */
  id: string;
  /** Null once the fold has taken the row out; the row still holds its place. */
  node: React.ReactNode;
}

export function ChatStream({
  isAgentRunning,
  isDeveloperMode,
  messages,
  onContinue,
  onModelChange,
  onRetry,
  onStartNewTask,
  renderAsItems = false,
  task,
}: ChatStreamProps) {
  const assetBaseUrl = getAssetBaseUrl(task.id);

  // Every group starts closed, a reopened task included: what a finished task
  // did is a list of the phases it went through, and the steps inside a phase
  // are there for the reader who asks for them.
  const [expandedGroupIds, setExpandedGroupIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (!next.delete(groupId)) {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const isGroupExpanded = useCallback(
    (group: TranscriptGroupData | undefined) =>
      group !== undefined && expandedGroupIds.has(group.id),
    [expandedGroupIds],
  );

  // The prompts the session was seeded with belong to the debug chat dialog,
  // not the transcript.
  const regularMessages = useMemo(
    () => messages.filter((message) => message.role !== "session-context"),
    [messages],
  );

  const lastMessageId = regularMessages.at(-1)?.id;
  const lastRegularMessage = regularMessages.at(-1);
  const lastAssistantMessage =
    lastRegularMessage?.role === "assistant" ? lastRegularMessage : undefined;

  const isToolStreaming = useCallback(
    (part: SessionMessagePart.ToolPart, message: SessionMessage.WithParts) =>
      isAgentRunning && lastMessageId === message.id && isActiveToolPart(part),
    [isAgentRunning, lastMessageId],
  );

  // A still-streaming text part at the tail of the live assistant message that
  // already has visible content. It is the one active state with no inline
  // loading affordance of its own (AssistantMessage renders plain markdown), so
  // it, and only it, suppresses the planning loader while it grows.
  const streamingTailText = useMemo(() => {
    if (!isAgentRunning || !lastAssistantMessage) {
      return;
    }
    const lastPart = lastAssistantMessage.parts.at(-1);
    if (
      lastPart?.type === "text" &&
      lastPart.state !== "done" &&
      lastPart.text.trim() !== ""
    ) {
      return lastPart.text;
    }
    return;
  }, [isAgentRunning, lastAssistantMessage]);

  const streamingTailTextStalled = useStreamStalled(streamingTailText);

  // Prose still arriving is its own loading state, and the one active state
  // with no inline affordance of its own (AssistantMessage renders plain
  // markdown). Stalled means it has stopped producing, so it stops counting.
  const hasStreamingTailText =
    streamingTailText !== undefined && !streamingTailTextStalled;

  const lastAssistantMessageHasVisibleParts = useMemo(() => {
    if (!lastAssistantMessage) {
      return false;
    }
    return lastAssistantMessage.parts.some((part) =>
      isVisibleAssistantPart({
        isDeveloperMode,
        isStreaming: isToolPart(part)
          ? isToolStreaming(part, lastAssistantMessage)
          : false,
        part,
      }),
    );
  }, [isDeveloperMode, isToolStreaming, lastAssistantMessage]);

  // Precomputed over the whole transcript, since a group and the run edges
  // around it both cross message boundaries.
  const layout = useMemo(
    () =>
      buildTranscriptLayout({
        hasStreamingTailText,
        isAgentRunning,
        isDeveloperMode,
        isToolStreaming,
        regularMessages,
      }),
    [
      hasStreamingTailText,
      isAgentRunning,
      isDeveloperMode,
      isToolStreaming,
      regularMessages,
    ],
  );

  const renderCtx: RenderPartContext = useMemo(
    () => ({
      assetBaseUrl,
      isAgentRunning,
      isDeveloperMode,
      isToolStreaming,
      lastMessageId,
      onRetry,
      task,
    }),
    [
      assetBaseUrl,
      isAgentRunning,
      isDeveloperMode,
      isToolStreaming,
      lastMessageId,
      onRetry,
      task,
    ],
  );

  // A group's head line copies the step the agent is on, which lives in some
  // later message than the one the group opens in. Rendering it means reaching
  // for a part by id rather than by where the loop below has got to.
  const partsById = useMemo(() => {
    const byId = new Map<
      string,
      {
        message: SessionMessage.WithParts;
        part: SessionMessagePart.Type;
        partIndex: number;
      }
    >();
    for (const message of regularMessages) {
      for (const [partIndex, part] of message.parts.entries()) {
        byId.set(part.metadata.id, { message, part, partIndex });
      }
    }
    return byId;
  }, [regularMessages]);

  const renderStandIn = useCallback(
    (group: TranscriptGroupData): React.ReactNode => {
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
        message: found.message,
        part: found.part,
        partIndex: found.partIndex,
      });
      if (!node) {
        return null;
      }

      // Under a heading the copy is one of the group's rows and sits where they
      // sit. With no heading it is the head line itself, so it takes the outer
      // edge and answers the clicks that open and close the group.
      return group.headingRowId === undefined ? (
        <TranscriptGroupHead key="stand-in">{node}</TranscriptGroupHead>
      ) : (
        <div className={GROUP_INDENT} key="stand-in">
          {node}
        </div>
      );
    },
    [isGroupExpanded, partsById, renderCtx],
  );

  const chatElements = useMemo(() => {
    const elements: React.ReactNode[] = [];
    let lastFooterIndex = 0;
    let previousBrowserStatusNote: string | undefined;
    let visibleAssistantContentCount = 0;

    for (const [messageIndex, message] of regularMessages.entries()) {
      const messageRows: MessageRow[] = [];

      const prevMessage = regularMessages[messageIndex - 1];
      const nextMessage = regularMessages[messageIndex + 1];
      const isFirstInConsecutiveAssistantGroup =
        message.role === "assistant" && prevMessage?.role !== "assistant";
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
          messageRows.push({ groupId: row?.groupId, id: rowId, node: null });
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

      const isLogoVisible =
        isFirstInConsecutiveAssistantGroup &&
        (!isLastMessage ||
          lastAssistantMessageHasVisibleParts ||
          layout.hasPlanningRow);

      if (isLogoVisible) {
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

        const shouldRenderFooter =
          assistantMessages.length > 0 &&
          visibleAssistantContentCount > 0 &&
          (!isLastMessage ||
            (!isAgentRunning && lastAssistantMessageHasVisibleParts));

        if (shouldRenderFooter) {
          messageElements.push(
            <AssistantMessagesFooter
              id={task.id}
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
          // No scrollAnchor: opting into the primitive's per-turn
          // anchor-to-top inflates a spacer and jumps the view up mid-stream
          // as tool-call DOM churns in. We only want follow-bottom +
          // release-on-scroll-up, so nothing is marked as an anchor.
          elements.push(
            <MessageScrollerItem
              className="flex flex-col gap-2"
              key={message.id}
              messageId={message.id}
            >
              {messageElements}
            </MessageScrollerItem>,
          );
        }
      } else {
        elements.push(...messageElements);
      }
    }

    // Planning is the tail of the turn, not a row of any one message in it. It
    // is drawn here, once, because the message it would otherwise belong to
    // changes underneath it: the agent's first message arrives and the row has
    // to move from the user's element into that one. Moved, it is a new element
    // wherever it lands, so it fades in a second time and the turn reads as
    // announcing itself twice. Drawn at the end it is the same element from the
    // moment the turn opens until a real row replaces it.
    if (layout.hasPlanningRow) {
      const tail: React.ReactNode[] = [];

      // The wordmark heads the turn, and planning is the first thing the turn
      // shows. Between the user sending and the agent's first message arriving
      // there is no assistant message for the wordmark to head, so it comes in
      // here instead. Without this the turn opens on a bare "Planning..." and
      // the wordmark drops in above it a moment later, pushing everything the
      // agent then says down the page.
      if (regularMessages.at(-1)?.role === "user") {
        tail.push(<TurnWordmark key={TURN_WORDMARK_ID} />);
      }

      // A run of one step, in the same box every other run of steps sits in:
      // without it the row is 4px lower than the step that replaces it, and the
      // transcript lifts every time the agent starts doing something.
      tail.push(
        <div className={STEP_RUN} key={PLANNING_ROW_ID}>
          <ReasoningMessage
            isLoading
            noDelay={!lastAssistantMessageHasVisibleParts}
            text=""
          />
        </div>,
      );

      // Keyed, both of them, or React reconciles the tail by its position in
      // the list and a message landing above it counts as a different element.
      if (renderAsItems) {
        elements.push(
          <MessageScrollerItem
            className="flex flex-col gap-2"
            key={PLANNING_ROW_ID}
          >
            {tail}
          </MessageScrollerItem>,
        );
      } else {
        elements.push(...tail);
      }
    }

    return elements;
  }, [
    regularMessages,
    renderCtx,
    renderAsItems,
    layout,
    assetBaseUrl,
    isGroupExpanded,
    task.id,
    isAgentRunning,
    isDeveloperMode,
    lastAssistantMessageHasVisibleParts,
    onContinue,
    onModelChange,
    onRetry,
    onStartNewTask,
    renderStandIn,
    toggleGroup,
  ]);

  const shouldShowContinueButton = useMemo(() => {
    if (messages.length === 0 || isAgentRunning) {
      return false;
    }
    const lastMessage = messages.at(-1);
    return (
      lastMessage?.role === "assistant" &&
      lastMessage.metadata.finishReason === "max-steps"
    );
  }, [messages, isAgentRunning]);

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
  groups: Map<string, TranscriptGroupData>;
  isGroupExpanded: (group: TranscriptGroupData | undefined) => boolean;
  onToggle: (groupId: string) => void;
  renderStandIn: (group: TranscriptGroupData) => React.ReactNode;
  rows: MessageRow[];
}): React.ReactNode[] {
  const runs: { groupId?: string; rows: MessageRow[] }[] = [];
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

    // The head line belongs to the slice the group opens on, or it would be
    // drawn again for every message the group runs through. The copy of the
    // step in flight follows the last row the group still draws, which is that
    // same slice until the agent writes something mid-phase.
    const heading = run.rows.some((row) => row.id === group.id)
      ? generatedGroupHeading(group)
      : undefined;
    const standIn = run.rows.some((row) => row.id === group.standInAfterRowId)
      ? renderStandIn(group)
      : null;

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

// What opens an assistant turn, wherever the turn is opening from.
function TurnWordmark() {
  return (
    <div className="flex justify-start">
      <Wordmark className="mt-5 mb-2 h-5.5 text-black/30 dark:text-white/30" />
    </div>
  );
}

// True once `text` stops changing for STREAM_STALL_MS. Timer-based, so it can't
// be derived declaratively: each new value arms a fresh timeout that records the
// value it settled on, and the result compares that against the current text so
// a still-growing stream never reads as stalled. Returns false when there is no
// streaming text.
function useStreamStalled(text: string | undefined) {
  const [stalledText, setStalledText] = useState<string>();
  useEffect(() => {
    if (text === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      setStalledText(text);
    }, STREAM_STALL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);
  return text !== undefined && stalledText === text;
}

// The wrapper a row sits in.
//
// A group's steps are indented under its head line. Prose is not, though the
// group still holds it: see `planRow` for why the answer a turn ends on cannot
// afford to be somewhere it will have to move away from.
//
// No vertical margins anywhere. The 8px rhythm is the group box's job (see
// `TranscriptGroup`), and it only works if every row in the box is the same
// height it looks: a step already carries 4px of padding for its click target,
// so anything in the box that is not a step is padded to match.
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
  if (!isIndented && !needsRowPadding) {
    return node;
  }
  return (
    <div
      className={cn(isIndented && GROUP_INDENT, needsRowPadding && "py-1")}
      key={`run-row-${key}`}
    >
      {node}
    </div>
  );
}
