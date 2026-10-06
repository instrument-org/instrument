import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  browserStatusModelNote,
  isToolPart,
  type SessionMessage,
  type SessionMessageDataPart,
  type SessionMessagePart,
  type StoreId,
  type Task,
} from "@instrument-org/workspace/client";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useEffect, useMemo, useState } from "react";

import { useTaskBackgroundProcesses } from "../hooks/use-task-background-processes";
import { chatSeparators } from "../lib/chat-separators";
import { cn } from "../lib/utils";
import {
  ASSISTANT_BUBBLE,
  ASSISTANT_BUBBLE_TAIL,
  hasBubbleWords,
} from "./assistant-message";
import { FollowedBubblesContext } from "./bubble-run-context";
import { AssistantMessagesFooter } from "./assistant-messages-footer";
import { AttachmentsCard } from "./attachments-card";
import { ChatSeparatorRow } from "./chat-separator";
import {
  renderChatPart,
  type RenderPartContext,
} from "./chat-stream-render-part";
import { FolderAttachmentsCard } from "./folder-attachments-card";
import { PlanningDotIcon } from "./icons/planning-dot";
import { MessageError } from "./message-error";
import {
  GroupHeading,
  WorkingGroupHeading,
} from "./message-part/group-heading";
import { GroupStandIn } from "./message-part/group-stand-in";
import { isAwaitingUser } from "./message-part/tool-call-utils";
import {
  STEP_RUN,
  TRANSCRIPT_ROW,
  TranscriptGroup,
  TranscriptGroupHead,
} from "./message-part/transcript-group";
import { ProjectContextNote } from "./project-context-note";
import { SentReplyQuote } from "./reply-quote";
import {
  type TranscriptExpansion,
  TranscriptExpansionContext,
} from "./transcript-expansion";
import {
  buildTranscriptLayout,
  generatedGroupHeading,
  groupCanExpand,
  groupHasHeading,
  groupStandInRowId,
  isActiveToolPart,
  isPartBeingWritten,
  isStepInFlight,
  isVisibleAssistantPart,
  planRow,
  type TranscriptGroup as TranscriptGroupData,
  type TranscriptLayout,
  type TranscriptRow,
} from "./transcript-layout";
import { useHoldRowInPlace } from "./transcript-row-position";
import { useReleaseAutoScroll } from "./transcript-scroll-context";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { MessageScrollerItem } from "./ui/message-scroller";
import { SentChips } from "./window/context-chip";
import { Wordmark } from "./wordmark";

// How far the rows a group holds sit inside its head line: the room a working
// heading's live indicator takes, which is the dot's 20px slot and the row's 8px
// gap less the 2px the heading is nudged by to sit the dot right. So while a
// phase runs, its steps begin exactly where its own title begins -- an icon
// under the first letter of the heading rather than two pixels off it. Once the
// heading settles and the dot goes, the same 26px is what reads as the indent.
const GROUP_INDENT = "pl-6.5";

// The wordmark's row key, for the one case where it is not a message's own
// chrome but a row in the turn that has not started yet.
const TURN_WORDMARK_ID = "turn-wordmark";

// The initial row has no message part of its own, so it needs a stable key as
// empty assistant messages arrive before the first visible part.
const PLANNING_ROW_ID = "planning";
/** The dots at the conversation's end while it works without words. */
const TYPING_TAIL_ID = "typing-tail";

// What the agent said, held apart from what it did. 24px above a paragraph
// written under a run of steps rather than the 8px the transcript puts between
// rows, so two things that look alike -- one line of text, the same size, the
// same leading -- read as the different kinds of thing they are. Runs of steps
// stay 8px from each other: the boundary is prose, not every group edge.
//
// 16px on top of the 8px already there, and always on the lower of the two
// rows; see `hasProseBoundaryAbove` for why it can only be read that way.
//
// The boundary is not symmetric. A run opening under a paragraph is that
// sentence's own consequence and is held closer to it; `PROSE_GAP_IN_GROUP` is
// where that side is set.
const PROSE_GAP = "mt-4";

// 12px, as padding, for a run of steps opening under a paragraph. With the 8px
// turn gap this leaves a 20px boundary: enough to distinguish action from
// prose without letting a single tool row drift away from the sentence that
// introduced it. The group box's own -4px margin is what holds its steps on
// the rhythm, so a margin here would be resolved against it rather than added.
const PROSE_GAP_IN_GROUP = "pt-3";

// The box a whole turn is drawn in, and the box a message the reader sent is
// drawn in. `gap-2` is the transcript's own rhythm, restated inside the box so
// that rows are 8px apart whether or not a boundary falls between them.
//
// `group/assistant-turn` is what a turn's footer answers to. It is the whole of
// what the agent produced -- the wordmark, every step, the footer itself -- so
// the row comes up wherever in the reply the pointer is, and a reader is never
// asked to find the footer in order to reveal it.
const TURN_BOX = "group/assistant-turn flex flex-col gap-2";
const SENT_BOX = "flex flex-col gap-2";

// The conversation's boxes are one speaker's run of bubbles, held 4px apart so
// the run reads as one cluster against the 16px the chat's column puts between
// speakers (`task/chat.tsx`).
const CHAT_TURN_BOX = "group/assistant-turn flex flex-col gap-1";
const CHAT_SENT_BOX = "flex flex-col gap-1";

// A box that goes on with the speaker of the one above it -- a second message
// sent before the reply came, the dots under a reply already in progress -- is
// pulled up out of the column's 16px to the 4px of the run it continues.
const CHAT_CONTINUES_RUN = "-mt-3";

interface AssistantMessageCheck {
  /**
   * The session, which is the only thing that can say whether a part is still
   * being written into: one carries a start with no end long after the run that
   * wrote it died. Handed on to `isPartBeingWritten` rather than folded into a
   * flag here, so this check and the transcript layout ask it the same way.
   */
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  isToolStreaming: (
    part: SessionMessagePart.ToolPart,
    message: SessionMessage.WithParts,
  ) => boolean;
  lastMessageId: StoreId.Message | undefined;
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
  /** Switches the chat to another model, where the reader can. */
  onModelChange?: (modelURI: AIGatewayModelURI.Type) => void;
  onRetry: (prompt: string) => void;
  /** Sends the last message again, where there is somewhere to send it. */
  onRunAgain?: () => void;
  /**
   * The chat's conversation is the one thing the user talks to, so
   * it opens no turn with the wordmark: there is nobody else it could be.
   */
  presentation?: "chat";
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
  onRetry,
  onRunAgain,
  presentation,
  renderAsItems = false,
  task,
}: ChatStreamProps) {
  const releaseAutoScroll = useReleaseAutoScroll();
  const holdRowInPlace = useHoldRowInPlace();

  // Every group starts closed, a reopened task included: what a finished task
  // did is a list of the phases it went through, and the steps inside a phase
  // are there for the reader who asks for them.
  const [expandedGroupIds, setExpandedGroupIds] = useState<
    ReadonlySet<StoreId.Part>
  >(() => new Set());

  // Which steps are open, held here rather than by the rows; see
  // `TranscriptExpansion` for why they cannot hold it themselves.
  const [expandedRowIds, setExpandedRowIds] = useState<
    ReadonlySet<StoreId.Part>
  >(() => new Set());

  // The steps that have already opened themselves, which is what leaves a
  // reader who shuts one shut: without it the row would open again on the next
  // frame, for as long as the call it draws is still running.
  const [selfOpenedRowIds, setSelfOpenedRowIds] = useState<
    ReadonlySet<StoreId.Part>
  >(() => new Set());

  const toggleGroup = (group: TranscriptGroupData) => {
    releaseAutoScroll();
    const isOpening = !expandedGroupIds.has(group.id);
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (!next.delete(group.id)) {
        next.add(group.id);
      }
      return next;
    });

    // A run too short for a heading is headed by a copy of one of its own
    // steps, so the click that opened it was a click on that step. Opening the
    // run alone answers with the row the reader just clicked, shut, somewhere
    // among its neighbors; opening the step too is what they asked for.
    // Shutting takes both back, since the head line is the only thing left to
    // shut the run with.
    //
    // A headed phase, named or generated, is headed by its title instead, and
    // a click there asks for the phase's steps rather than any one of them. Its
    // copy is an ordinary row that already opens itself and the phase around
    // it; see `setRowExpanded`.
    const headRowId = groupHasHeading(group)
      ? undefined
      : groupStandInRowId({ group, isExpanded: !isOpening });
    if (headRowId === undefined) {
      return;
    }
    setExpandedRowIds((current) => {
      const next = new Set(current);
      if (isOpening) {
        next.add(headRowId);
      } else {
        next.delete(headRowId);
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

  // The conversation reads as a text chat, so it marks when it started and on
  // what, a return after a quiet spell, and a switch of model.
  const separators =
    presentation === "chat" ? chatSeparators(regularMessages) : undefined;

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
      isAgentRunning,
      isDeveloperMode,
      isToolStreaming,
      lastMessageId,
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
  // The conversation's transcript has no runs of steps to fold: its calls are
  // not shown, and what is shown of them stands on its own as a row. A group
  // headed by a copy of a hidden call would have no head line to shut it with.
  const layout: TranscriptLayout =
    presentation === "chat"
      ? {
          groups: new Map(),
          rows: new Map(),
          // A call waiting on the user still opens itself here, and so does
          // the card asking to connect an app: the answer comes from the
          // row, and a shut row reads as a stall.
          selfOpeningRowIds: regularMessages.flatMap((message) =>
            message.parts.flatMap((part) =>
              isToolPart(part) &&
              (isAwaitingUser(part) || part.type === "tool-connect_app")
                ? [part.metadata.id]
                : [],
            ),
          ),
        }
      : buildTranscriptLayout({
          isAgentRunning,
          isDeveloperMode,
          isToolStreaming,
          regularMessages,
        });

  /**
   * Opens these steps, and the phases they sit in.
   *
   * The phase, because the fold takes a step off screen the moment the agent
   * moves on to the next one: a step opened inside a shut group is replaced by
   * whatever the agent did next, and what the reader asked to see is gone
   * before they have finished reading it. The group stays open afterwards, so
   * the step holds its place in the run while the phase works past it.
   */
  const expandRows = (rowIds: readonly StoreId.Part[]) => {
    setExpandedRowIds((current) => new Set([...current, ...rowIds]));
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      for (const rowId of rowIds) {
        const groupId = layout.rows.get(rowId)?.groupId;
        if (groupId !== undefined) {
          next.add(groupId);
        }
      }
      return next;
    });
  };

  // The steps that open for themselves, taken once each. Scrolling is not
  // handed back for these: nothing the reader did opened them, so the
  // transcript goes on following its own end the way it was.
  const openingNow = layout.selfOpeningRowIds.filter(
    (rowId) => !selfOpenedRowIds.has(rowId),
  );
  if (openingNow.length > 0) {
    setSelfOpenedRowIds(new Set([...openingNow, ...selfOpenedRowIds]));
    expandRows(openingNow);
  }

  const expansion: TranscriptExpansion = {
    isRowExpanded: (rowId) => expandedRowIds.has(rowId),
    setRowExpanded: (rowId, isExpanded) => {
      releaseAutoScroll();
      if (isExpanded) {
        // Opening the phase draws its other steps above this one, so the row
        // the reader clicked is no longer where they clicked it. Held in place,
        // the phase unfolds above the row instead of carrying it off screen.
        holdRowInPlace(rowId);
        expandRows([rowId]);
        return;
      }
      setExpandedRowIds((current) => {
        const next = new Set(current);
        next.delete(rowId);
        return next;
      });
    },
  };

  const renderCtx: RenderPartContext = {
    isAgentRunning,
    isDeveloperMode,
    isToolStreaming,
    lastMessageId,
    onRetry,
    presentation,
    task,
  };

  // Ids of everything this task still has running, so a folded group can say
  // that one of the commands behind it has outlived the turn that started it.
  // The same query the task header reads, so a transcript full of promoted
  // calls costs no extra request.
  const runningProcessIds = new Set(
    useTaskBackgroundProcesses(task.id).map((process) => process.id),
  );

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

  /**
   * How many commands started inside this group are still running. Read from the
   * live registry rather than from `processId` alone, which a part records once
   * and never clears: a settled phase from this morning would otherwise still
   * be claiming its server was up.
   */
  const groupRunningProcessCount = (group: TranscriptGroupData): number =>
    group.toolCalls.filter((call) => {
      const part = partsById.get(call.rowId)?.part;
      return (
        part?.type === "tool-bash" &&
        part.state === "output-available" &&
        part.output.processId !== undefined &&
        runningProcessIds.has(part.output.processId)
      );
    }).length;

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
    return groupHasHeading(group) ? (
      <div className={GROUP_INDENT} key="stand-in">
        {slot}
      </div>
    ) : (
      <TranscriptGroupHead key="stand-in">{slot}</TranscriptGroupHead>
    );
  };

  const followedBubbles = new Set<string>();
  const chatElements = buildChatElements();
  // One set for as long as the same bubbles are followed, so a render that
  // moves no tail re-renders no bubble: the transcript renders on every token
  // the agent writes.
  const followedKey = [...followedBubbles].join(" ");
  const stableFollowedBubbles = useMemo(
    () => new Set(followedKey.split(" ")),
    [followedKey],
  );

  function buildChatElements() {
    const elements: React.ReactNode[] = [];
    let lastFooterIndex = 0;
    let previousBrowserStatusNote: string | undefined;
    let visibleAssistantContentCount = 0;

    // The turn being built. A turn is one message per step, so its rows arrive
    // over several passes of the loop below and are held here until the run
    // ends: everything the agent produced for one prompt goes in one box, named
    // by the message that opened it.
    let turnRows: React.ReactNode[] = [];
    let turnId: StoreId.Message | undefined;
    // The words the conversation last said in this turn. A model that retries
    // a failed command says its line again before the retry, and the second
    // copy is the same reply twice, not a second reply.
    let lastSaidInTurn: string | undefined;
    const turnBox = presentation === "chat" ? CHAT_TURN_BOX : TURN_BOX;
    const sentBox = presentation === "chat" ? CHAT_SENT_BOX : SENT_BOX;
    // Who the last box drawn belongs to, so the next one by the same speaker
    // can join its run.
    let lastSpeaker: "assistant" | "user" | undefined;
    // The bubbles of the run being drawn, and of the box being built for it,
    // by the id of the part each draws.
    let runBubbles: string[] = [];
    let boxBubbles: string[] = [];
    const endRun = () => {
      for (const id of runBubbles.slice(0, -1)) {
        followedBubbles.add(id);
      }
      runBubbles = [];
    };
    // Draws the box just built into its speaker's run, or opens a run of its
    // own, and answers the class that pulls a box that goes on with a run up
    // to it.
    const joinRun = (speaker: "assistant" | "user", opensRun = false) => {
      const continues =
        presentation === "chat" && lastSpeaker === speaker && !opensRun;
      if (!continues) {
        endRun();
      }
      runBubbles.push(...boxBubbles);
      boxBubbles = [];
      lastSpeaker = speaker;
      return continues ? CHAT_CONTINUES_RUN : undefined;
    };

    for (const [messageIndex, message] of regularMessages.entries()) {
      if (message.role === "user") {
        lastSaidInTurn = undefined;
      }
      const messageRows: MessageRow[] = [];

      const nextMessage = regularMessages[messageIndex + 1];
      const isLastInConsecutiveAssistantGroup =
        message.role === "assistant" && nextMessage?.role !== "assistant";
      const isLastMessage = messageIndex === regularMessages.length - 1;

      // Attachments are hoisted into per-message chrome below.
      const fileAttachments: SessionMessagePart.Type[] = [];
      let projectContextPart: SessionMessagePart.DataPart | undefined;
      let replyPart: SessionMessageDataPart.ReplyDataPart | undefined;
      let sentChips: SessionMessageDataPart.SentChip[] = [];
      const seenSourceIds = new Set<string>();

      // The conversation's own replies land whole: while a step is still
      // being composed its words are held back and the dots at the tail stand
      // in, so what the user reads is what was sent, never what is being typed.
      // A reply that was superseded before it finished is shown only in
      // developer mode.
      const isComposing =
        presentation === "chat" &&
        message.role === "assistant" &&
        ((isAgentRunning && isLastMessage && !message.metadata.finishedAt) ||
          (!isDeveloperMode && message.metadata.error?.kind === "aborted"));

      for (const [partIndex, stored] of message.parts.entries()) {
        // What is drawn for the part: the part itself, or the part with the
        // words the turn already said taken off it.
        let part = stored;
        if (isComposing && part.type === "text") {
          continue;
        }
        if (
          presentation === "chat" &&
          message.role === "assistant" &&
          part.type === "text"
        ) {
          const said = part.text.trim();
          if (said !== "") {
            if (
              lastSaidInTurn !== undefined &&
              said.startsWith(lastSaidInTurn)
            ) {
              // The line again, on its own or with something after it (a
              // files fence, once the file exists): the line stands where it
              // was, and only what follows it is new.
              const rest = said.slice(lastSaidInTurn.length).trim();
              if (rest === "") {
                continue;
              }
              part = { ...part, text: rest };
            }
            lastSaidInTurn = said;
          }
        }
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

        // Drawn over the message as chips; the note the agent read stays a
        // developer-mode row of its own.
        if (message.role === "user" && part.type === "data-viewContext") {
          sentChips = part.data.attached ?? [];
        }

        if (message.role === "user" && part.type === "data-reply") {
          replyPart = part.data;
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
          message,
          part,
          partIndex,
        });
        if (!node) {
          // A step the group holds without drawing still takes its place in
          // the run, since the group it belongs to may open on it.
          if (row?.groupId !== undefined) {
            messageRows.push({
              groupId: row.groupId,
              hasProseBoundaryAbove: row.hasProseBoundaryAbove,
              id: rowId,
              node: null,
            });
          }
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
        if (
          presentation === "chat" &&
          part.type === "text" &&
          (message.role === "user" || hasBubbleWords(part.text))
        ) {
          boxBubbles.push(part.metadata.id);
        }
      }

      const messageElements = collectGroups({
        groupRunningProcessCount,
        groups: layout.groups,
        isGroupExpanded,
        onToggle: toggleGroup,
        renderStandIn,
        rows: messageRows,
      });

      // --- Per-message chrome ---

      if (presentation !== "chat" && wordmarkMessageIds.has(message.id)) {
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

        // Over the files, as the chips stood over the words they went with.
        if (sentChips.length > 0) {
          messageElements.unshift(
            <SentChips chips={sentChips} key={`sent-chips-${message.id}`} />,
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

        // Over everything the message carries, the way a reply reads in any
        // messaging app: what it answers first.
        if (replyPart && messageElements.length > 0) {
          messageElements.unshift(
            <SentReplyQuote key={`reply-${message.id}`} reply={replyPart} />,
          );
        }

        const separator = separators?.get(message.id);
        if (separator && messageElements.length > 0) {
          messageElements.unshift(
            <ChatSeparatorRow
              key={`separator-${message.id}`}
              separator={separator}
            />,
          );
        }
      }

      // A reply the conversation superseded is not an error to anyone; it
      // is simply not shown, outside developer mode.
      const superseded =
        presentation === "chat" &&
        !isDeveloperMode &&
        message.role === "assistant" &&
        message.metadata.error?.kind === "aborted";
      // A run of the same refusal, one per retry, reads as one: only the
      // latest is shown, outside developer mode.
      const repeatedBelow =
        !isDeveloperMode &&
        isSameRefusal(message, regularMessages[messageIndex + 1]);
      if (
        message.role === "assistant" &&
        message.metadata.error &&
        !superseded &&
        !repeatedBelow
      ) {
        messageElements.push(
          <MessageError
            isAgentRunning={isAgentRunning}
            isDeveloperMode={isDeveloperMode}
            isLastMessage={isLastMessage}
            key={`error-${message.id}`}
            message={message}
            onContinue={onContinue}
            onModelChange={onModelChange}
            onRunAgain={onRunAgain}
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

        if (
          hasFooter && // The conversation's replies stand on their own: no footer of times and tokens under each.
          presentation !== "chat"
        ) {
          messageElements.push(
            <AssistantMessagesFooter
              alwaysVisible={alwaysShowFooter}
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

      if (message.role === "assistant") {
        turnId ??= message.id;
        turnRows.push(...messageElements);

        // The run is over, so the turn is whole and can be drawn. A turn that
        // produced nothing draws no box at all.
        if (isLastInConsecutiveAssistantGroup) {
          if (turnRows.length > 0) {
            const joinsRun = joinRun("assistant");
            elements.push(
              renderAsItems ? (
                <MessageScrollerItem
                  className={cn(turnBox, joinsRun)}
                  key={turnId}
                  messageId={turnId}
                >
                  {turnRows}
                </MessageScrollerItem>
              ) : (
                <div className={turnBox} key={turnId}>
                  {turnRows}
                </div>
              ),
            );
          }
          turnRows = [];
          turnId = undefined;
        }
      } else if (messageElements.length > 0) {
        // What the reader sent is where a turn starts, and it is the one row per
        // turn that says so. Anchoring it moves it to the reading line on
        // arrival and holds it there while the reply grows into the room the
        // scroller reserves below, so the column stops moving under whatever is
        // being read.
        //
        // A message under a separator of its own opens a new run.
        const joinsRun = joinRun("user", separators?.has(message.id));
        elements.push(
          renderAsItems ? (
            <MessageScrollerItem
              className={cn(sentBox, joinsRun)}
              key={message.id}
              messageId={message.id}
              // The conversation keeps to its end, the way a chat does; a
              // turn brought to the top is for reading work back.
              scrollAnchor={presentation !== "chat"}
            >
              {messageElements}
            </MessageScrollerItem>
          ) : (
            <div className={sentBox} key={message.id}>
              {messageElements}
            </div>
          ),
        );
      }
    }

    // A turn opens the moment the user sends, before there is a visible part to
    // hang either of these on -- and the agent's first message can arrive empty,
    // so the window outlasts it. Drawn at the tail they keep one identity across
    // that whole window, and the first real row replaces the planning line in a
    // single step rather than fading a second copy in beneath it.
    if (isAwaitingFirstRow && presentation !== "chat") {
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

    // The conversation at work: from the moment the user sends, through the
    // words of a step being composed and the gaps between calls and steps, the
    // dots stand at its end, since that is where the next thing comes out.
    // One row under one key for the whole run, so going from one of those to
    // the next never takes the dots away and fades a new copy in.
    if (presentation === "chat" && (isAgentRunning || isAwaitingFirstRow)) {
      // The dots are the assistant's last bubble while they stand, so the
      // reply above them gives its tail up to them.
      boxBubbles.push(TYPING_TAIL_ID);
      const joinsRun = joinRun("assistant");
      elements.push(
        renderAsItems ? (
          <MessageScrollerItem className={joinsRun} key={TYPING_TAIL_ID}>
            <TypingRow />
          </MessageScrollerItem>
        ) : (
          <TypingRow key={TYPING_TAIL_ID} />
        ),
      );
    }
    endRun();

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
  // The provider draws nothing, so the scroller still sees the turns as its own
  // element's children; it walks the DOM rather than the element tree.
  if (renderAsItems) {
    return (
      <TranscriptExpansionContext value={expansion}>
        <FollowedBubblesContext value={stableFollowedBubbles}>
          <TailFirst items={chatElements} />
        </FollowedBubblesContext>
        {continueNode && (
          <MessageScrollerItem key="continue">
            {continueNode}
          </MessageScrollerItem>
        )}
      </TranscriptExpansionContext>
    );
  }

  return (
    <TranscriptExpansionContext value={expansion}>
      <FollowedBubblesContext value={stableFollowedBubbles}>
        <div className="flex w-full flex-col gap-2">
          <div className="flex flex-col gap-2">{chatElements}</div>
          {continueNode}
        </div>
      </FollowedBubblesContext>
    </TranscriptExpansionContext>
  );
}

/** How many of a transcript's last turns are drawn the moment it arrives. */
const TAIL_ITEMS = 12;

/** How many older turns are put back above them each time the window is idle. */
const FILL_ITEMS = 6;

/**
 * The conversation is composing: three dots in a bubble of their own, the
 * way a messaging app says someone is typing, in the place the reply will
 * land. No words are shown until the reply is whole.
 */
export function TypingRow() {
  return (
    <div className="flex animate-in justify-start fill-mode-both fade-in">
      <span
        aria-label="Typing"
        // The dots always end the run they stand in.
        className={cn(
          ASSISTANT_BUBBLE,
          ASSISTANT_BUBBLE_TAIL,
          "flex h-9 items-center gap-1",
        )}
      >
        {[0, 1, 2].map((index) => (
          <span
            className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
            key={index}
            style={{ animationDelay: `${index * 150}ms` }}
          />
        ))}
      </span>
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
  isAgentRunning,
  isDeveloperMode,
  isToolStreaming,
  lastMessageId,
  message,
}: AssistantMessageCheck) {
  const error = message.metadata.error;
  if (error && (isDeveloperMode || error.kind !== "aborted")) {
    return true;
  }
  return hasVisibleAssistantParts({
    isAgentRunning,
    isDeveloperMode,
    isToolStreaming,
    lastMessageId,
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
  groupRunningProcessCount,
  groups,
  isGroupExpanded,
  onToggle,
  renderStandIn,
  rows,
}: {
  groupRunningProcessCount: (group: TranscriptGroupData) => number;
  groups: Map<StoreId.Part, TranscriptGroupData>;
  isGroupExpanded: (group: TranscriptGroupData | undefined) => boolean;
  onToggle: (group: TranscriptGroupData) => void;
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
    // The phase the agent named, or for a run it did not name, a summary of
    // what it held once it is over.
    const heading = isOpeningSlice
      ? (group.title ?? generatedGroupHeading(group))
      : undefined;
    const standIn = isOpeningSlice ? renderStandIn(group) : null;

    // With the group folded, a middle slice holds nothing that draws, and an
    // empty box is a blank gap down the transcript where the steps used to be.
    if (
      nodes.length === 0 &&
      heading === undefined &&
      standIn === null &&
      !(isOpeningSlice && group.phase === "working")
    ) {
      return [];
    }

    // With a heading over it the copy of the step in flight is one of the
    // group's rows and follows them; with no heading it is the head line and
    // leads.
    const standsAtHead = !groupHasHeading(group);

    return (
      <TranscriptGroup
        canExpand={groupCanExpand(group)}
        className={cn(
          openingRow?.hasProseBoundaryAbove === true && PROSE_GAP_IN_GROUP,
        )}
        isExpanded={isGroupExpanded(group)}
        key={`group-${group.id}-${run.rows[0]?.id ?? ""}`}
        onToggle={() => {
          onToggle(group);
        }}
        runningProcessCount={groupRunningProcessCount(group)}
      >
        {heading !== undefined && (
          <GroupHeading
            isRunning={group.phase === "working"}
            key="heading"
            title={heading}
          />
        )}
        {isOpeningSlice &&
          heading === undefined &&
          group.phase === "working" && (
            <WorkingGroupHeading key="heading" startedAt={group.startedAt} />
          )}
        {standsAtHead && standIn}
        {nodes}
        {!standsAtHead && standIn}
      </TranscriptGroup>
    );
  });
}

/**
 * Whether the message holds a part that draws a row, or a step in flight that
 * the working group it opens will draw a heading for.
 *
 * Not the same question as how many rows the transcript loop went on to emit
 * for it. That is a count of what was drawn, and the fold sits between the two:
 * a settled group keeps its rows and shows one of them. This is about the parts.
 */
function hasVisibleAssistantParts({
  isAgentRunning,
  isDeveloperMode,
  isToolStreaming,
  lastMessageId,
  message,
}: AssistantMessageCheck) {
  return message.parts.some((part, partIndex) => {
    const isStreaming = isToolPart(part)
      ? isToolStreaming(part, message)
      : false;
    return (
      isStepInFlight({
        isAgentRunning,
        isStreaming,
        lastMessageId,
        message,
        part,
      }) ||
      isVisibleAssistantPart({
        isDeveloperMode,
        isLivePart: isPartBeingWritten({
          isAgentRunning,
          lastMessageId,
          message,
          partIndex,
        }),
        isStreaming,
        part,
      })
    );
  });
}

function isSameRefusal(
  message: SessionMessage.WithParts,
  next: SessionMessage.WithParts | undefined,
): boolean {
  if (message.role !== "assistant" || next?.role !== "assistant") {
    return false;
  }
  const error = message.metadata.error;
  const nextError = next.metadata.error;
  if (!error || !nextError || error.kind !== nextError.kind) {
    return false;
  }
  const classification =
    "classification" in error ? error.classification : undefined;
  const nextClassification =
    "classification" in nextError ? nextError.classification : undefined;
  return classification !== undefined && classification === nextClassification;
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
}: Omit<AssistantMessageCheck, "lastMessageId" | "message"> & {
  regularMessages: SessionMessage.WithParts[];
}) {
  const lastMessageId = regularMessages.at(-1)?.id;
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
      isAgentRunning,
      isDeveloperMode,
      isToolStreaming,
      lastMessageId,
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

/**
 * A transcript's turns, drawn from the end: the last few at once, where the
 * reader lands, and the older ones above them a few at a time while the
 * window is idle, until the whole transcript is there. Drawing every turn of
 * a long conversation at once holds the window for as long as the
 * conversation is long, every time it is opened.
 *
 * The scroller keeps what is on screen in place as turns arrive above it, and
 * each turn keeps its key, so the ones already drawn are never drawn again.
 * Turns added at the end while it fills are shown as they come.
 */
function TailFirst({ items }: { items: React.ReactNode[] }) {
  const [hidden, setHidden] = useState(() =>
    Math.max(0, items.length - TAIL_ITEMS),
  );

  useEffect(() => {
    if (hidden === 0) {
      return;
    }
    // A deadline, so a window that is never idle still fills.
    const handle = requestIdleCallback(
      () => {
        setHidden((count) => Math.max(0, count - FILL_ITEMS));
      },
      { timeout: 500 },
    );
    return () => {
      cancelIdleCallback(handle);
    };
  }, [hidden]);

  return items.slice(hidden);
}

// What opens an assistant turn, wherever the turn is opening from.
function TurnWordmark() {
  return (
    // The wordmark owns the extra 10px below it so prose and tool rows begin on
    // the same visual rhythm. Putting it on either row would make the spacing
    // depend on which kind of content happens to open the turn.
    <div className="flex justify-start pb-2.5">
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
