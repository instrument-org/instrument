import {
  getToolNameByType,
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
  type ToolName,
} from "@instrument-org/workspace/client";

import { summarizeToolRun } from "../lib/tool-display";
import { dataPartVisibility, isDataPart } from "./chat-stream-data-parts";
import {
  isActivityHeadingVisible,
  isToolCallVisible,
  isToolPartRunning,
} from "./message-part/tool-call-utils";
import { isReasoningPartVisible } from "./reasoning-utils";

// How many calls an unannounced run needs before it is worth folding under a
// generated heading. "Read a file" says less than the row it would replace,
// which at least said which file.
const MIN_INFERRED_GROUP_CALLS = 2;

/**
 * A run of steps -- tool calls and reasoning -- drawn as one unit.
 *
 * There are two kinds, and they differ only in where the heading comes from. A
 * **declared** group is opened by the agent calling `start_activity` and headed
 * by that row. An **inferred** group is any other unbroken run of steps, headed
 * by a phrase generated from what it turned out to contain.
 *
 * A group is `working` until something closes it and `settled` after, and
 * between them that is the whole of how it draws:
 *
 * |          | working                                  | settled                        |
 * | -------- | ---------------------------------------- | ------------------------------ |
 * | declared | heading, and the step in flight under it | heading, rows folded behind it |
 * | inferred | the step in flight, standing for the run | generated heading, rows folded |
 *
 * So a phase of work costs one line whether or not the agent named it, and
 * while it runs that line is whatever the agent is doing at that moment.
 *
 * The step in flight is drawn as a *copy*, in a slot the group owns, and its own
 * row stays folded with the rest. A group reaches across many messages -- a turn
 * is one message per step -- so the step it is on moves down the transcript as
 * it works; drawing it where it sits would move the folded group with it, which
 * is the whole run flickering from one place to another every step. The copy
 * holds one slot in one place and changes only what it says.
 */
export interface TranscriptGroup {
  /**
   * The step the agent is on, which a working group draws in place of everything
   * it holds. Absent once the group settles, since nothing in it is happening
   * any more.
   */
  activeRowId?: string;
  /**
   * Steps and notes it holds, counted across the whole group and not the part
   * any one message happens to carry. A group routinely spans several messages,
   * so anything decided from a single message's share of it is decided from a
   * fraction. These are the rows the fold takes away the moment it closes.
   */
  foldedRowCount: number;
  /** The `start_activity` row heading it. Absent on an inferred group. */
  headingRowId?: string;
  /**
   * Also the id of the row the group opens on, which is how a renderer working
   * one message at a time tells the slice that starts the group from the ones
   * that continue it.
   */
  id: string;
  /**
   * The last row the fold took away, absent until one lands. A working group
   * falls back to this for the line it shows while the agent works out what to
   * do next, so a phase that pauses keeps saying what it just did rather than
   * emptying out. Prose clears it: a paragraph draws where it sits, so once the
   * agent has said something the phase's latest line is already on screen.
   */
  lastRowId?: string;
  phase: "settled" | "working";
  /**
   * Paragraphs it holds. They fold away too, but not until the phase is over:
   * while it runs, what the agent said about the work stays on screen next to
   * the work.
   */
  proseRowCount: number;
  /**
   * The row the copy of the step in flight is drawn after: the last of the
   * group's rows that the fold leaves on screen. It is the row the group opened
   * on until the agent writes something mid-phase, and then that paragraph,
   * because a copy drawn above prose the agent wrote earlier puts the steps of
   * a phase in the wrong order.
   */
  standInAfterRowId: string;
  /** Its tool calls in order, which is what a generated heading is built from. */
  toolNames: ToolName[];
}

export interface TranscriptLayout {
  groups: Map<string, TranscriptGroup>;
  /**
   * Whether the turn ends on the planning row.
   *
   * It is the last resort, and says only that the agent is working with nothing
   * to show for it yet. Anything already reading as in flight says that better:
   * a call running, a phase heading, reasoning arriving, prose still being
   * written. Two of them at once read as two things happening at once, so this
   * is decided here, where what else is on screen is already known.
   */
  hasPlanningRow: boolean;
  rows: Map<string, TranscriptRow>;
}

/** Where one row sits in the transcript. */
export interface TranscriptRow {
  /** The group it is drawn in, its heading row included. */
  groupId?: string;
  id: string;
  /**
   * What kind of thing it is, which is the whole of how it behaves in a group.
   *
   * A **step** is the agent at work -- a tool call or a reasoning block -- and
   * folds away with the rest of its phase. It brings its own row padding. A
   * **note** is anything else attached to the run, and folds the same way. Prose
   * is neither: it is what the agent said rather than how it worked, so it draws
   * whether the phase is open or shut.
   */
  kind: "note" | "prose" | "step";
}

/**
 * Works out which rows belong together, and how the runs of compact status rows
 * sit against the prose around them.
 *
 * Nothing in the data says a call belongs to a group. No tool part carries a
 * group id, and a declared group is only ever implied by the agent having
 * announced one before making the calls. So membership is read positionally: a
 * group opens at a `start_activity` row, or at the first step after a break,
 * and closes at the next heading or at the end of the turn.
 *
 * Prose is the one boundary that reads differently for the two kinds. It closes
 * an inferred group, because an unannounced run is only a run and the agent
 * turning to address the user is the clearest break in one. It does not close a
 * declared group: there the agent has said where the boundary is, and a note
 * dropped mid-phase belongs to the phase it interrupted rather than ending it.
 * The prose that ends a turn is outside every group either way -- that is the
 * answer the user came for, and folding it away would hide the point.
 *
 * Which of those a paragraph is can only be told from what follows it, so it is
 * told at the one moment that is settled: the end of the turn. Until then every
 * paragraph is a note dropped mid-phase, and the last one leaves its phase once
 * the turn is over -- which costs it no movement, since prose sits at the margin
 * whether a phase holds it or not.
 */
export function buildTranscriptLayout({
  hasStreamingTailText,
  isAgentRunning,
  isDeveloperMode,
  isToolStreaming,
  regularMessages,
}: {
  /** The turn's last prose is still arriving, which is its own loading state. */
  hasStreamingTailText: boolean;
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  isToolStreaming: (
    part: SessionMessagePart.ToolPart,
    message: SessionMessage.WithParts,
  ) => boolean;
  regularMessages: SessionMessage.WithParts[];
}): TranscriptLayout {
  const lastMessageId = regularMessages.at(-1)?.id;
  const flat: TranscriptRow[] = [];
  const groups = new Map<string, TranscriptGroup>();
  const seenSourceIds = new Set<string>();

  // The group still taking rows, if any. Settling is what writes one out, so
  // every group in the map is final except the last.
  let open: TranscriptGroup | undefined;

  const settle = () => {
    if (open) {
      groups.set(open.id, {
        ...open,
        activeRowId: undefined,
        phase: "settled",
      });
      open = undefined;
    }
  };
  // Every row joins through here, so a group's own tally of what it holds can
  // never fall behind the rows attributed to it.
  const push = (id: string, kind: TranscriptRow["kind"]): TranscriptRow => {
    const row: TranscriptRow = { groupId: open?.id, id, kind };
    flat.push(row);
    if (!open || id === open.headingRowId) {
      return row;
    }
    if (kind === "prose") {
      // The paragraph is the phase's latest line and is drawn where it sits, so
      // there is nothing left to copy and nowhere above it to copy anything to.
      open.proseRowCount++;
      open.lastRowId = undefined;
      open.standInAfterRowId = id;
      return row;
    }
    open.foldedRowCount++;
    if (kind === "step") {
      open.lastRowId = id;
    }
    return row;
  };

  // The last thing each turn said, which is that turn's answer. Collected as the
  // pass runs rather than looked for afterwards, because "the answer" is the
  // last paragraph of a turn and not the last row of one: plenty can come after
  // it without making it any less the answer.
  const replies: TranscriptRow[] = [];
  let lastProseRow: TranscriptRow | undefined;

  for (const message of regularMessages) {
    const isLiveMessage = isAgentRunning && message.id === lastMessageId;
    if (message.role === "user") {
      settle();
      // The user speaking ends the turn before it, whatever state it left off
      // in, so whatever that turn last said is now its answer for good.
      if (lastProseRow) {
        replies.push(lastProseRow);
        lastProseRow = undefined;
      }
    }

    for (const part of message.parts) {
      if (part.type === "source-document" || part.type === "source-url") {
        if (seenSourceIds.has(part.sourceId)) {
          continue;
        }
        seenSourceIds.add(part.sourceId);
        continue;
      }

      // A phase boundary before it is a row. The agent announcing a phase ends
      // whatever was running, and a title it left blank ends one just the same
      // -- it draws nothing, but the work after it is no longer what came
      // before. Read after the row was filtered out, a blank one is invisible
      // twice over, and the calls that follow it join the phase it ended.
      if (part.type === "tool-start_activity") {
        const isHeading = isActivityHeadingVisible(part);
        // Still arriving, so it has not yet said whether it has a title. The
        // phase it may end is left alone until it has.
        if (!isHeading && part.state === "input-streaming") {
          continue;
        }
        settle();
        if (isHeading) {
          open = emptyGroup(part.metadata.id, {
            headingRowId: part.metadata.id,
          });
          push(part.metadata.id, "step");
        }
        continue;
      }

      const isStreaming = isToolPart(part)
        ? isToolStreaming(part, message)
        : false;
      if (!isRenderableInlinePart({ isDeveloperMode, isStreaming, part })) {
        continue;
      }

      const id = part.metadata.id;
      const kind: TranscriptRow["kind"] =
        isToolPart(part) || part.type === "reasoning"
          ? "step"
          : part.type === "text"
            ? "prose"
            : "note";

      if (part.type === "text") {
        // Prose ends an unannounced run: a run is only a run, and the agent
        // turning to address the user ends one. It does not end a declared
        // phase -- there the agent said where the boundary is -- and it joins
        // it instead, drawn under the heading with the steps it sits among.
        if (open?.headingRowId === undefined) {
          settle();
        }
        const row = push(id, kind);
        if (message.role === "assistant") {
          lastProseRow = row;
        }
        continue;
      }

      // Only a step opens an inferred group. Anything else -- a data note, an
      // attachment -- stands alone unless a group is already taking rows.
      if (!open) {
        if (kind !== "step") {
          push(id, kind);
          continue;
        }
        open = emptyGroup(id);
      }

      push(id, kind);
      if (isToolPart(part)) {
        open.toolNames.push(getToolNameByType(part.type));
      }
      markLive({
        group: open,
        id,
        isLive: isPartLive({ isLiveMessage, isStreaming, part }),
      });
    }
  }

  // Nothing else is saying the agent is working, so the planning row has to.
  // A phase heading counts: a declared group still taking rows reads as running
  // on its own, and a planning row under it is the second thing moving.
  const hasPlanningRow =
    isAgentRunning &&
    !hasStreamingTailText &&
    open?.activeRowId === undefined &&
    open?.headingRowId === undefined;

  // The agent has stopped, so whatever the last turn said last is now its
  // answer too.
  if (!isAgentRunning && lastProseRow) {
    replies.push(lastProseRow);
  }

  // Whatever is still open reaches the end of the transcript. It counts as
  // working only if the agent is: a task that stopped mid-run has nothing in
  // flight, whatever its last rows still say.
  if (open) {
    groups.set(
      open.id,
      isAgentRunning
        ? open
        : { ...open, activeRowId: undefined, phase: "settled" },
    );
  }

  // A turn's answer belongs to no phase. A phase is closed by the next one
  // starting or by the turn ending -- nothing closes one from the inside -- so
  // a turn that used tools always ends inside a phase, and that is where the
  // answer gets written. Left in, the phase folding would take the answer with
  // it, and there is no rule about how a phase folds that is worth losing the
  // thing the user asked for.
  //
  // Done last, so every group is in the map and it does not matter which one
  // the answer landed in.
  for (const row of replies) {
    if (row.groupId === undefined) {
      continue;
    }
    const group = groups.get(row.groupId);
    if (group) {
      group.proseRowCount--;
    }
    row.groupId = undefined;
  }

  return {
    groups,
    hasPlanningRow,
    rows: new Map(flat.map((row): [string, TranscriptRow] => [row.id, row])),
  };
}

/**
 * The heading an inferred group draws above its rows, or undefined when it has
 * none.
 *
 * A declared group draws its own `start_activity` row instead, so it returns
 * nothing here. An inferred one earns a heading only once it has settled -- a
 * run still in progress is represented by the row in flight -- and only if it
 * holds enough calls for a summary to say more than the rows it replaces.
 */
export function generatedGroupHeading(
  group: TranscriptGroup,
): string | undefined {
  if (group.headingRowId !== undefined || group.phase === "working") {
    return undefined;
  }
  if (group.toolNames.length < MIN_INFERRED_GROUP_CALLS) {
    return undefined;
  }
  return summarizeToolRun(group.toolNames);
}

/**
 * Whether opening the group shows anything the folded view does not, which is
 * what decides whether it draws a chevron and answers a click at all.
 *
 * An unannounced run still in flight is headed by a copy of one of its own rows,
 * so there is only more to see once it holds more than that one. Everywhere else
 * the head line is not a row, and a single row behind it is still a row hidden.
 */
export function groupCanExpand(group: TranscriptGroup): boolean {
  if (!groupFoldsRows(group)) {
    return false;
  }
  // Paragraphs count only once the phase is over, since until then they are on
  // screen and opening the group would not reveal them.
  const hidden =
    group.foldedRowCount +
    (group.phase === "settled" ? group.proseRowCount : 0);
  return group.headingRowId === undefined && group.phase === "working"
    ? hidden > 1
    : hidden > 0;
}

/**
 * The row a working group copies into the slot it draws in place of its
 * contents, or undefined when it has none.
 *
 * A declared group draws the copy under its heading while folded: the heading
 * says what the phase is and the copy says where it has got to. Opening it shows
 * the steps themselves, so the copy goes. An inferred group has no heading, so
 * the copy is its head line and stays whether it is open or shut -- open, it is
 * also the only thing that can shut it again.
 */
export function groupStandInRowId({
  group,
  isExpanded,
}: {
  group: TranscriptGroup;
  isExpanded: boolean;
}): string | undefined {
  if (group.phase !== "working") {
    return undefined;
  }
  // Opening a named phase shows the steps themselves, so the copy goes.
  if (isExpanded && group.headingRowId !== undefined) {
    return undefined;
  }
  // The step in flight, or the last one the group finished while the agent
  // works out what is next. Falling back is what keeps a phase from emptying
  // out under its heading between one call and the next, and an unannounced run
  // from unfolding every time it pauses and folding up again when it stops.
  return group.activeRowId ?? group.lastRowId;
}

export function isActiveToolPart(part: SessionMessagePart.ToolPart) {
  return (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    (part.state === "output-available" && part.preliminary === true)
  );
}

export function isVisibleAssistantPart({
  isDeveloperMode,
  isStreaming,
  part,
}: {
  isDeveloperMode: boolean;
  isStreaming: boolean;
  part: SessionMessagePart.Type;
}) {
  if (part.type === "text") {
    return part.state !== "done" || part.text.trim() !== "";
  }

  if (isToolPart(part)) {
    return isToolCallVisible({ isDeveloperMode, isStreaming, part });
  }

  if (part.type === "reasoning") {
    return isReasoningPartVisible(part);
  }

  if (isDataPart(part)) {
    return dataPartVisibility(part) === "always";
  }

  // Remaining parts (step-start, file, source-*) never count as visible content.
  return false;
}

/**
 * How one row of a group draws. The whole fold is here.
 *
 * A folding group shows its head line and nothing else until the reader opens
 * it, whatever phase it is in: what the agent is doing right now reaches the
 * screen as the copy in the group's own slot, not as the row itself. A group
 * with nothing to head it keeps every row, since there would be nothing left to
 * open it from.
 *
 * Prose is held by its phase but never indented under it. A phase ends when the
 * next one starts or when the turn does -- nothing closes one from the inside --
 * so a turn that used tools always ends inside a phase, and that is where the
 * answer the user came for gets written. It has to leave when the turn is over,
 * or the phase folding would take the answer with it. Left at the margin all
 * along, leaving costs it nothing: the paragraph is in the same place before and
 * after, and all that changes is whether the fold can still reach it.
 *
 * It waits for the fold, too. A paragraph stays on screen while the phase it was
 * written in is still running, because it is what the agent has to say about the
 * work going on around it. Once the phase is over it folds away with the steps.
 */
export function planRow({
  group,
  isExpanded,
  row,
}: {
  group: TranscriptGroup | undefined;
  isExpanded: boolean;
  row: TranscriptRow | undefined;
}): { isHidden: boolean; isIndented: boolean } {
  if (!group || !row) {
    return { isHidden: false, isIndented: false };
  }
  // The heading is the head line rather than something held behind it.
  if (row.id === group.headingRowId) {
    return { isHidden: false, isIndented: false };
  }
  const folds = groupFoldsRows(group);
  if (row.kind === "prose") {
    return {
      isHidden: folds && !isExpanded && group.phase === "settled",
      isIndented: false,
    };
  }
  return { isHidden: folds && !isExpanded, isIndented: folds };
}

function emptyGroup(
  id: string,
  { headingRowId }: { headingRowId?: string } = {},
): TranscriptGroup {
  return {
    foldedRowCount: 0,
    headingRowId,
    id,
    phase: "working",
    proseRowCount: 0,
    standInAfterRowId: id,
    toolNames: [],
  };
}

/**
 * Whether the group has a line standing for its contents, and so folds them
 * away. Without one there would be nothing left to open it from, and it keeps
 * every row instead.
 */
function groupFoldsRows(group: TranscriptGroup): boolean {
  if (group.headingRowId !== undefined) {
    return true;
  }
  return group.phase === "working"
    ? group.foldedRowCount > 0
    : generatedGroupHeading(group) !== undefined;
}

// Whether this row is the agent at work rather than a record of work it has
// finished. Always read against the live session and never the part alone: a
// tool call keeps its start with no end, and a reasoning part keeps its
// streaming state, long after the run that wrote them died.
function isPartLive({
  isLiveMessage,
  isStreaming,
  part,
}: {
  isLiveMessage: boolean;
  isStreaming: boolean;
  part: SessionMessagePart.Type;
}) {
  if (isToolPart(part)) {
    return isStreaming && isToolPartRunning(part);
  }
  return (
    isLiveMessage && part.type === "reasoning" && part.state === "streaming"
  );
}

// Whether a part renders inline. Data parts derive from `dataPartVisibility`,
// the same source `renderChatPart` uses, so the two stay consistent.
function isRenderableInlinePart({
  isDeveloperMode,
  isStreaming,
  part,
}: {
  isDeveloperMode: boolean;
  isStreaming: boolean;
  part: SessionMessagePart.Type;
}) {
  if (part.type === "text") {
    return part.state !== "done" || part.text.trim() !== "";
  }

  if (isDataPart(part)) {
    const visibility = dataPartVisibility(part);
    if (visibility === "hidden") {
      return false;
    }
    // Developer-mode-only debug peek; otherwise hidden like attachments.
    if (visibility === "dev") {
      return isDeveloperMode;
    }
    return true;
  }

  if (part.type === "step-start") {
    return false;
  }

  if (part.type === "source-document" || part.type === "source-url") {
    return false;
  }

  if (part.type === "file") {
    return false;
  }

  if (isToolPart(part)) {
    return isToolCallVisible({ isDeveloperMode, isStreaming, part });
  }

  // Only reasoning parts remain; visibility depends on their content.
  return isReasoningPartVisible(part);
}

function markLive({
  group,
  id,
  isLive,
}: {
  group: TranscriptGroup;
  id: string;
  isLive: boolean;
}) {
  if (isLive) {
    group.activeRowId = id;
  }
}
