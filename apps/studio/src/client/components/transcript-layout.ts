import {
  getToolNameByType,
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
  type StoreId,
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
  activeRowId?: StoreId.Part;
  /**
   * Steps and notes it holds, counted across the whole group and not the part
   * any one message happens to carry. A group routinely spans several messages,
   * so anything decided from a single message's share of it is decided from a
   * fraction. These are the rows the fold takes away the moment it closes.
   */
  foldedRowCount: number;
  /** The `start_activity` row heading it. Absent on an inferred group. */
  headingRowId?: StoreId.Part;
  /**
   * Also the id of the row the group opens on, which is how a renderer working
   * one message at a time tells the slice that starts the group from the ones
   * that continue it.
   */
  id: StoreId.Part;
  /**
   * The last row the fold took away, absent until one lands. A working group
   * falls back to this for the line it shows while the agent works out what to
   * do next, so a phase that pauses keeps saying what it just did rather than
   * emptying out.
   */
  lastRowId?: StoreId.Part;
  phase: "settled" | "working";
  /**
   * Its tool calls in order: the names a generated heading is built from, and
   * the row each one sits in, for the run that ends up folding under a copy of
   * its own single call rather than under a phrase.
   */
  toolCalls: { name: ToolName; rowId: StoreId.Part }[];
}

export interface TranscriptLayout {
  groups: Map<StoreId.Part, TranscriptGroup>;
  rows: Map<StoreId.Part, TranscriptRow>;
  /** The rows the transcript opens for itself; see `opensOnSight`. */
  selfOpeningRowIds: StoreId.Part[];
}

/** Where one row sits in the transcript. */
export interface TranscriptRow {
  /** The group it is drawn in, its heading row included. */
  groupId?: StoreId.Part;
  /**
   * Whether the row above this one is on the other side of the line between
   * what the agent said and what it did: a paragraph under a run of steps, or a
   * run of steps under a paragraph. It is the one boundary in a turn worth more
   * than the transcript's usual spacing, and the renderer widens it.
   *
   * Read as a property of the *lower* row and never the upper one, which is
   * what keeps it from moving anything. A row's neighbor above is settled the
   * moment the row exists; the row below it is whatever the agent does next, so
   * a boundary read downwards would grow a row already on screen the moment the
   * next step arrived.
   *
   * A boundary the user's own message sits across is not one of these. That is
   * the start of a turn, which the wordmark already spaces.
   */
  hasProseBoundaryAbove?: boolean;
  id: StoreId.Part;
  /**
   * What kind of thing it is, which is the whole of how it behaves in a group.
   *
   * A **step** is the agent at work -- a tool call or a reasoning block -- and
   * folds away with the rest of its phase. It brings its own row padding. A
   * **note** is anything else attached to the run, and folds the same way. Prose
   * is neither: it is what the agent said rather than how it worked, and it ends
   * the phase it lands after rather than joining one.
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
 * and closes at the next heading, at a paragraph, or at the end of the turn.
 *
 * Prose closes a group of either kind. The agent turning to address the user is
 * the clearest break in a run there is, and taking it as one means every
 * boundary can be read the moment it arrives: a paragraph belongs to no phase,
 * and whatever the agent does after it opens a phase of its own, named or not.
 * So nothing already drawn changes as the turn goes on -- a paragraph never
 * folds away later, and a phase never grows a step underneath something written
 * before it.
 */
export function buildTranscriptLayout({
  isAgentRunning,
  isDeveloperMode,
  isToolStreaming,
  regularMessages,
}: {
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
  const groups = new Map<StoreId.Part, TranscriptGroup>();
  const seenSourceIds = new Set<string>();
  const selfOpeningRowIds: StoreId.Part[] = [];

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
  // The row before this one when both are the agent's own, for the boundary
  // below. Cleared at the user's own rows: a turn's first row sits under the
  // wordmark rather than under whatever the turn before it ended on.
  let rowAbove: TranscriptRow | undefined;
  let inAssistantMessage = false;

  // Every row joins through here, so a group's own tally of what it holds can
  // never fall behind the rows attributed to it.
  const push = (id: StoreId.Part, kind: TranscriptRow["kind"]) => {
    const row: TranscriptRow = { groupId: open?.id, id, kind };
    if (inAssistantMessage && rowAbove && isProseBoundary(rowAbove, row)) {
      row.hasProseBoundaryAbove = true;
    }
    rowAbove = inAssistantMessage ? row : undefined;
    flat.push(row);
    if (!open || id === open.headingRowId) {
      return;
    }
    open.foldedRowCount++;
    if (kind === "step") {
      open.lastRowId = id;
    }
  };

  for (const message of regularMessages) {
    const isLiveMessage = isAgentRunning && message.id === lastMessageId;
    inAssistantMessage = message.role === "assistant";
    if (message.role === "user") {
      settle();
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
        // Prose ends the phase it lands after, named or not. The agent turning
        // to address the user is the clearest break in a run there is, and a
        // phase carried on across it would go on collecting steps that belong
        // underneath the paragraph rather than above it.
        settle();
        push(id, kind);
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
        open.toolCalls.push({ name: getToolNameByType(part.type), rowId: id });
        if (isStreaming && isToolPartRunning(part) && opensOnSight(part)) {
          selfOpeningRowIds.push(id);
        }
      }
      markLive({
        group: open,
        id,
        isLive: isPartLive({ isLiveMessage, isStreaming, part }),
      });
    }
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

  return {
    groups,
    rows: new Map(
      flat.map((row): [StoreId.Part, TranscriptRow] => [row.id, row]),
    ),
    selfOpeningRowIds,
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
  if (group.toolCalls.length < MIN_INFERRED_GROUP_CALLS) {
    return undefined;
  }
  return summarizeToolRun(group.toolCalls.map((call) => call.name));
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
  // A run headed by a copy of one of its own rows has more to show only once it
  // holds more than that one; everywhere else the head line is not a row, and a
  // single row behind it is still a row hidden.
  const isHeadedByOwnRow =
    group.headingRowId === undefined &&
    (group.phase === "working" || soleToolCallRowId(group) !== undefined);

  return isHeadedByOwnRow ? group.foldedRowCount > 1 : group.foldedRowCount > 0;
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
}): StoreId.Part | undefined {
  if (group.phase !== "working") {
    return soleToolCallRowId(group);
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
 * Prose is not here at all. A paragraph ends the phase it lands after and
 * belongs to none, so nothing the fold does can reach what the agent said.
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
  return { isHidden: folds && !isExpanded, isIndented: folds };
}

function emptyGroup(
  id: StoreId.Part,
  { headingRowId }: { headingRowId?: StoreId.Part } = {},
): TranscriptGroup {
  return {
    foldedRowCount: 0,
    headingRowId,
    id,
    phase: "working",
    toolCalls: [],
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
  if (group.phase === "working") {
    return group.foldedRowCount > 0;
  }
  return (
    generatedGroupHeading(group) !== undefined ||
    soleToolCallRowId(group) !== undefined
  );
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

// Whether these two rows sit either side of the line between what the agent
// said and what it did. A paragraph against a run of steps is the boundary; a
// paragraph against a note the run filed, or one run of steps against the next,
// is not.
function isProseBoundary(above: TranscriptRow, below: TranscriptRow): boolean {
  return above.kind === "prose"
    ? below.groupId !== undefined
    : below.kind === "prose" && above.groupId !== undefined;
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
  id: StoreId.Part;
  isLive: boolean;
}) {
  if (isLive) {
    group.activeRowId = id;
  }
}

/**
 * Whether the transcript opens this call the first time it catches it running,
 * rather than waiting to be asked.
 *
 * Only image generation. Every other call is either quick enough that the line
 * saying it started is the whole of what there is to see, or textual enough
 * that its row already says what it did. This one runs for the better part of a
 * minute and produces a picture, so the reader who is watching has nothing to
 * watch, and the reader who looks away comes back to a line of text standing in
 * for an image.
 *
 * Opening it opens the phase around it too, the same as if the reader had asked
 * (see `ChatStream`), which is what leaves the picture on screen once the run
 * moves on to the next step.
 */
function opensOnSight(part: SessionMessagePart.ToolPart): boolean {
  return part.type === "tool-generate_image";
}

/**
 * The one call a settled run folds under, when a phrase built from the run would
 * say less than that call's own row does.
 *
 * A lone call keeps its row: "Read a file" replaces a line that at least said
 * which file, which is why a generated heading needs two. But the run around a
 * call is rarely only the call -- the agent thinks before it acts and again
 * after -- and three rows where two of them say "Thought" is worth folding even
 * though the phrase is not worth writing. So the call heads its own run: one
 * line, and it is the line that says which file.
 *
 * Only with something else to fold. A run that is just the one call is already
 * the line it would fold to.
 */
function soleToolCallRowId(group: TranscriptGroup): StoreId.Part | undefined {
  if (group.headingRowId !== undefined || group.phase !== "settled") {
    return undefined;
  }
  if (group.toolCalls.length !== 1 || group.foldedRowCount < 2) {
    return undefined;
  }
  return group.toolCalls[0]?.rowId;
}
