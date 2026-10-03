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
  isAwaitingUser,
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
 * **declared** group is a run of calls the agent put in one phase, by writing
 * the same `activity` on each, and is headed by it. An **inferred** group is
 * any other unbroken run of steps, headed by a phrase generated from what it
 * turned out to contain.
 *
 * A group is `working` until something closes it and `settled` after, and
 * between them that is the whole of how it draws:
 *
 * |          | working                                            | settled                        |
 * | -------- | -------------------------------------------------- | ------------------------------ |
 * | declared | heading, and the step in flight under it           | heading, rows folded behind it |
 * | inferred | "Working for 12s", and the step in flight under it | generated heading, rows folded |
 *
 * So a phase of work reads the same whether or not the agent named it: a
 * heading that carries the live indicator for as long as it runs, and under it
 * whatever the agent is doing at that moment. An unnamed phase has nothing to
 * say about what it is until it is over, so while it runs its heading says how
 * long it has been going, which is the thing that shows it is still moving.
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
   * When the row it opens on was created, which is what a working inferred
   * group's heading counts up from.
   */
  startedAt: Date;
  /** The phase its calls named, which heads it. Absent on an inferred group. */
  title?: string;
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
   * A step the group holds without drawing: a call streamed in and queued, or
   * a thought with nothing under it. It keeps its place in the run, so the
   * group can open on it, and counts for nothing else.
   */
  isHeld?: boolean;
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
 * group id; each call carries the phase the agent put it in, as its `activity`,
 * and a call naming a different phase from the one before it starts another.
 * So membership is read positionally: a group opens at a call naming a new
 * phase, or at the first step after a break, and closes at the next such call,
 * at a paragraph, or at the end of the turn. A call naming no phase stays in the
 * one it follows.
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
  // never fall behind the rows attributed to it. A held row (see below) is a
  // member that draws nothing, so it is left out of the tally.
  const push = (
    id: StoreId.Part,
    kind: TranscriptRow["kind"],
    { isHeld = false }: { isHeld?: boolean } = {},
  ) => {
    const row: TranscriptRow = { groupId: open?.id, id, kind };
    if (isHeld) {
      row.isHeld = true;
    }
    if (inAssistantMessage && rowAbove && isProseBoundary(rowAbove, row)) {
      row.hasProseBoundaryAbove = true;
    }
    rowAbove = inAssistantMessage ? row : undefined;
    flat.push(row);
    if (!open || isHeld) {
      return;
    }
    open.foldedRowCount++;
    if (kind === "step") {
      open.lastRowId = id;
    }
  };

  for (const message of regularMessages) {
    inAssistantMessage = message.role === "assistant";
    if (message.role === "user") {
      settle();
    }

    for (const [partIndex, part] of message.parts.entries()) {
      const isLivePart = isPartBeingWritten({
        isAgentRunning,
        lastMessageId,
        message,
        partIndex,
      });
      if (part.type === "source-document" || part.type === "source-url") {
        if (seenSourceIds.has(part.sourceId)) {
          continue;
        }
        seenSourceIds.add(part.sourceId);
        continue;
      }

      // A phase boundary before it is a row, and before the call is filtered
      // out: a queued call that draws nothing still names the phase it is in,
      // and the calls after it are read against that.
      if (isToolPart(part)) {
        open = openPhase(open, part, settle);
      }

      const isStreaming = isToolPart(part)
        ? isToolStreaming(part, message)
        : false;
      if (
        !isRenderableInlinePart({
          isDeveloperMode,
          isLivePart,
          isStreaming,
          part,
        })
      ) {
        // A step that draws nothing is still a step of the run, and is held
        // in it: a call streamed in and queued behind another, or a thought
        // that opened with nothing under it. Membership read off what draws
        // moves under a run in flight, because what draws changes as the
        // agent works -- a batch of calls each shows while its input streams,
        // hides while it waits its turn, and shows again once it runs. The
        // group opens on whichever of its rows comes first, so it would be
        // opened on a different row at every one of those moments, drawn
        // afresh each time, and between two of them it would have no row
        // at all and leave the transcript.
        if (isToolPart(part) || part.type === "reasoning") {
          open ??= emptyGroup(part);
          push(part.metadata.id, "step", { isHeld: true });
        }
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

      if (part.type === "data-contextRollover") {
        // Positional where the other notes are incidental: this one's whole
        // content is where it sits, so it ends the phase around it the way
        // prose does. It is recorded against whatever message was newest when
        // assembly ran, which mid-run is an assistant step inside an open
        // phase, and the rule below would fold it in among the steps. Reading
        // it then means expanding a group to find the one row that says where
        // the cut was, which is the whole of what it is for.
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
        open = emptyGroup(part);
      }

      push(id, kind);
      if (isToolPart(part)) {
        open.toolCalls.push({ name: getToolNameByType(part.type), rowId: id });
        // A call waiting on the user opens itself whatever the session is
        // doing: the buttons on it are how the turn goes on, and a reader who
        // has to find and open the row first reads a pause as a stall. The
        // card asking to connect an app is the same kind of thing, though the
        // call itself returned at once: the answer comes from the card.
        if (
          (isStreaming && isToolPartRunning(part) && opensOnSight(part)) ||
          isAwaitingUser(part) ||
          part.type === "tool-connect_app"
        ) {
          selfOpeningRowIds.push(id);
        }
      }
      markLive({
        group: open,
        id,
        isLive: isPartLive({ isLivePart, isStreaming, part }),
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
 * The summary a settled inferred group draws above its rows, or undefined when
 * it has none.
 *
 * A declared group draws its own title instead, and a working one draws how
 * long it has been going, so both return nothing here. A settled
 * one earns a summary only if it holds enough calls for it to say more than
 * the rows it replaces. The count is read once the run is over and never
 * while it works: a call still unfinished is a row only while it is in the
 * newest message, so a tally taken mid-run goes down as well as up.
 */
export function generatedGroupHeading(
  group: TranscriptGroup,
): string | undefined {
  if (group.title !== undefined || group.phase === "working") {
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
    !groupHasHeading(group) && soleToolCallRowId(group) !== undefined;

  return isHeadedByOwnRow ? group.foldedRowCount > 1 : group.foldedRowCount > 0;
}

/**
 * Whether the group's head line is a heading -- the agent's, the working
 * clock, or a generated summary -- rather than a copy of one of its own steps.
 * Under a heading the copy of the step in flight is one of the group's rows;
 * without one it is the head line.
 */
export function groupHasHeading(group: TranscriptGroup): boolean {
  return (
    group.title !== undefined ||
    group.phase === "working" ||
    generatedGroupHeading(group) !== undefined
  );
}

/**
 * The row a group copies into the slot it draws in place of its contents, or
 * undefined when it has none.
 *
 * A working group draws the copy under its heading while folded: the heading
 * says the phase is still going and the copy says where it has got to. Opening
 * it shows the steps themselves, so the copy goes. A settled run with one call
 * in it is headed by a copy of that call instead; see `soleToolCallRowId`.
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
  // Opening the phase shows the steps themselves, so the copy goes.
  if (isExpanded) {
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

/**
 * Whether the run is still writing into this part: the last part of the last
 * message, while the agent is running.
 *
 * The rule lives in one place because the layout and the row renderer both ask
 * it and have to agree. Each half of it is load-bearing. The session, because a
 * part carries a start with no end long after the run that wrote it died. The
 * position, because anything after a part means the model has moved on,
 * whatever that part's own state says.
 *
 * Asking it two different ways is what took a running turn off the screen: the
 * layout counted a blank reasoning row that the renderer drew nothing for, that
 * row became the group's stand-in, and a group whose every other row was folded
 * behind it had nothing left to draw at all.
 */
export function isPartBeingWritten({
  isAgentRunning,
  lastMessageId,
  message,
  partIndex,
}: {
  isAgentRunning: boolean;
  lastMessageId: string | undefined;
  message: SessionMessage.WithParts;
  partIndex: number;
}) {
  return (
    isAgentRunning &&
    message.id === lastMessageId &&
    partIndex === message.parts.length - 1
  );
}

/**
 * Whether this part is a step the agent is at work on in the message being
 * written, whether or not it draws a row yet: a call streaming in or queued, or
 * a thought still open. The turn it is in has begun, which is what the
 * transcript needs to know before any of its steps draws.
 */
export function isStepInFlight({
  isAgentRunning,
  isStreaming,
  lastMessageId,
  message,
  part,
}: {
  isAgentRunning: boolean;
  isStreaming: boolean;
  lastMessageId: string | undefined;
  message: SessionMessage.WithParts;
  part: SessionMessagePart.Type;
}): boolean {
  if (isToolPart(part)) {
    return isStreaming;
  }
  return (
    part.type === "reasoning" &&
    part.state === "streaming" &&
    isAgentRunning &&
    message.id === lastMessageId
  );
}

export function isVisibleAssistantPart({
  isDeveloperMode,
  isLivePart,
  isStreaming,
  part,
}: {
  isDeveloperMode: boolean;
  isLivePart: boolean;
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
    return isReasoningPartVisible({ isLive: isLivePart, part });
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
  const folds = groupFoldsRows(group);
  return { isHidden: folds && !isExpanded, isIndented: folds };
}

/**
 * The phase a call names, from its `activity`, or undefined when it names none:
 * the field arrives first while the call streams in, and a model can leave it
 * out or blank.
 */
function activityOf(part: SessionMessagePart.ToolPart): string | undefined {
  const input: unknown = part.input;
  if (typeof input !== "object" || input === null || !("activity" in input)) {
    return undefined;
  }
  const activity =
    typeof input.activity === "string" ? input.activity.trim() : "";
  return activity === "" ? undefined : activity;
}

function emptyGroup(
  part: SessionMessagePart.Type,
  { title }: { title?: string } = {},
): TranscriptGroup {
  return {
    foldedRowCount: 0,
    id: part.metadata.id,
    phase: "working",
    startedAt: part.metadata.createdAt,
    title,
    toolCalls: [],
  };
}

/**
 * Whether the group has a line standing for its contents, and so folds them
 * away. Without one there would be nothing left to open it from, and it keeps
 * every row instead.
 */
function groupFoldsRows(group: TranscriptGroup): boolean {
  if (group.title !== undefined) {
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
  isLivePart,
  isStreaming,
  part,
}: {
  isLivePart: boolean;
  isStreaming: boolean;
  part: SessionMessagePart.Type;
}) {
  if (isToolPart(part)) {
    return isStreaming && isToolPartRunning(part);
  }
  return isLivePart && part.type === "reasoning" && part.state === "streaming";
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
  isLivePart,
  isStreaming,
  part,
}: {
  isDeveloperMode: boolean;
  isLivePart: boolean;
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

  // Only reasoning parts remain; visibility depends on their content and on
  // whether the run that opened them is still writing into them.
  return isReasoningPartVisible({ isLive: isLivePart, part });
}

/**
 * The group a call joins: the open one, unless the call names a phase other
 * than the one it heads, which settles it and opens the next.
 *
 * Two cases stay where they are. A call still streaming in whose activity is so
 * far the start of the open phase's title is that phase arriving a word at a
 * time, and opening a group for every partial title would draw a heading per
 * keystroke. And a run that has only thought so far, with no call yet, takes
 * the title of the first call that names one, rather than leaving the thinking
 * behind as a group of its own under no heading.
 */
function openPhase(
  open: TranscriptGroup | undefined,
  part: SessionMessagePart.ToolPart,
  settle: () => void,
): TranscriptGroup | undefined {
  const activity = activityOf(part);
  if (activity === undefined || activity === open?.title) {
    return open;
  }
  if (
    open?.title !== undefined &&
    part.state === "input-streaming" &&
    open.title.startsWith(activity)
  ) {
    return open;
  }
  if (open && open.title === undefined && open.toolCalls.length === 0) {
    open.title = activity;
    return open;
  }
  settle();
  return emptyGroup(part, { title: activity });
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
  if (group.title !== undefined || group.phase !== "settled") {
    return undefined;
  }
  if (group.toolCalls.length !== 1 || group.foldedRowCount < 2) {
    return undefined;
  }
  return group.toolCalls[0]?.rowId;
}
