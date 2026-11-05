import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type StoreId } from "../../schemas/store-id";
import { MID_TURN_NOTE } from "../chat/mid-turn";
import { dataPartVisibility } from "../data-part-visibility";
import {
  isStepPart,
  type StepPart,
  type TranscriptMessage,
  type TranscriptPart,
} from "./transcript-message";

/** A step and the facts measured about it. */
export interface TurnStep extends StepPart {
  facts?: SessionMessageDataPart.StepFactsDataPart;
}

/** A run of tool calls one activity names, in the order they ran. */
export interface ActivityRow {
  /** The apps its calls reached, in the order they first did. */
  apps: string[];
  /** Each label's count across the activity, the newest first. */
  counts: { count: number; label: string }[];
  endedAt?: Date;
  id: StoreId.Part;
  kind: "activity";
  sites: string[];
  startedAt: Date;
  steps: TurnStep[];
  /** What the agent called it; absent on a run it did not name. */
  title?: string;
}

/** Everything a turn draws, in order. */
export type TurnRow =
  | ActivityRow
  | { id: StoreId.Part; kind: "ask"; part: SessionMessagePart.ToolPart }
  | {
      endedTurn: boolean;
      id: string;
      isLastMessage: boolean;
      kind: "error";
      message: TranscriptMessage & { role: "assistant" };
    }
  | { id: StoreId.Part; kind: "note"; part: SessionMessagePart.DataPart }
  | {
      id: StoreId.Part;
      kind: "task";
      sessionId: StoreId.Session;
      startedAt: Date;
    }
  | { id: StoreId.Part; kind: "text"; part: SessionMessagePart.TextPart };

/** What opens a turn: what the person sent, or what the chat told a task. */
export interface TurnOpener {
  chips: SessionMessageDataPart.SentChip[];
  files: SessionMessageDataPart.FileAttachmentDataPart[];
  folders: SessionMessageDataPart.SentFolderDataPart[];
  /** What the chat wrote to a task, drawn as its words rather than a person's. */
  fromChat?: SessionMessageDataPart.FromChatDataPart;
  /** It joined a turn already running rather than starting one. */
  joinedMidTurn: boolean;
  message: TranscriptMessage;
  notes: SessionMessagePart.DataPart[];
  text?: SessionMessagePart.TextPart;
}

/** What the working line says of a turn in flight. */
export type TurnLive =
  | { activityId: StoreId.Part; kind: "activity" }
  | { kind: "thinking"; since: Date }
  | { kind: "writing" };

/**
 * Everything since the message the person typed, wakes included: a sign-in
 * answered or a task finished carries the same work on, so it is the same
 * turn. `rows` is all of it; `foldedRowIds` says which of them the Worked row
 * stands for once the turn folds.
 */
export interface Turn {
  /** The apps its work reached. */
  apps: string[];
  /** When it stopped working and writing; absent while it works. */
  endedAt?: Date;
  /** The rows the Worked row stands for. Empty when the turn does not fold. */
  foldedRowIds: ReadonlySet<string>;
  /** It folds on finishing, rather than because a message cut across it. */
  foldsWhenDone: boolean;
  id: StoreId.Message;
  /** Taken over from the chat a task forked from, ahead of the task's own work. */
  inherited: boolean;
  live?: TurnLive;
  opener?: TurnOpener;
  phase: "done" | "interrupted" | "working";
  /** Its assistant messages, for what its footer says of them. */
  replies: (SessionMessage.Assistant & { parts: TranscriptPart[] })[];
  rows: TurnRow[];
  sites: string[];
  sources: (
    | SessionMessagePart.SourceDocumentPart
    | SessionMessagePart.SourceUrlPart
  )[];
  startedAt: Date;
  /** The line a side call wrote for the Worked row, once it has. */
  summary?: string;
  /** How long its work took, up to the words it ended on. */
  workedMs: number;
}

/** How long a finished turn waits for its summary before it folds without one. */
export const FOLD_WAIT_MS = 4000;

export interface TurnsOfOptions {
  isDeveloperMode?: boolean;
  isRunning: boolean;
  /** The session being read; a task's history begins with its chat's messages. */
  sessionId?: StoreId.Session;
}

/** Each turn from an earlier call, kept while its messages stay the same objects. */
export type TurnsCache = Map<
  StoreId.Message,
  {
    cutAcross: boolean;
    isLive: boolean;
    slice: TranscriptMessage[];
    turn: Turn;
  }
>;

/**
 * The turns a session's messages come to. The one place that decides what
 * belongs together and what folds: the same messages always give the same
 * turns, so a change to the rules rewrites no records, and everything drawn
 * reads the answer rather than working it out from a part.
 *
 * With a `cache`, a slice whose messages are the same objects as last time
 * keeps its turn, so a token streaming into the last reply rebuilds one turn.
 */
export function turnsOf(
  messages: readonly TranscriptMessage[],
  { isDeveloperMode = false, isRunning, sessionId }: TurnsOfOptions,
  cache?: TurnsCache,
): Turn[] {
  const slices = turnSlices(messages);
  const lastMessage = messages.at(-1);
  return slices.flatMap((slice, index) => {
    const [first] = slice;
    if (!first) {
      return [];
    }
    const next = slices[index + 1]?.[0];
    const isLive = next === undefined && isRunning;
    const cutAcross = next !== undefined && joinedMidTurn(next);
    const kept = cache?.get(first.id);
    if (
      kept &&
      kept.isLive === isLive &&
      kept.cutAcross === cutAcross &&
      kept.slice.length === slice.length &&
      kept.slice.every((message, at) => message === slice[at])
    ) {
      return [kept.turn];
    }
    const turn = buildTurn(first, slice, {
      cutAcross,
      isDeveloperMode,
      isLive,
      lastMessage,
      sessionId,
    });
    cache?.set(first.id, { cutAcross, isLive, slice, turn });
    return [turn];
  });
}

/**
 * Whether a turn is folded at this moment: it finished with words, and either
 * its summary has arrived or it has waited long enough for it. A turn a
 * message cut across folds at once.
 */
export function isTurnFolded(turn: Turn, now: number): boolean {
  if (turn.foldedRowIds.size === 0) {
    return false;
  }
  if (!turn.foldsWhenDone) {
    return true;
  }
  return (
    turn.summary !== undefined ||
    (turn.endedAt !== undefined && now - turn.endedAt.getTime() >= FOLD_WAIT_MS)
  );
}

/**
 * The messages cut into turns: each message a person typed opens one, and what
 * follows belongs to it until the next.
 */
export function turnSlices<T extends TranscriptMessage>(
  messages: readonly T[],
): T[][] {
  const slices: T[][] = [];
  for (const message of messages) {
    const current = slices.at(-1);
    if (opensTurn(message) || !current) {
      slices.push([message]);
    } else {
      current.push(message);
    }
  }
  return slices;
}

/**
 * Whether a message opens a turn: the person wrote or sent something, or the
 * chat wrote to its task. A user message with none of that is a wake, the app
 * telling the agent what happened.
 */
export function opensTurn(message: {
  parts: readonly (SessionMessagePart.Type | TranscriptPart)[];
  role: SessionMessage.WithParts["role"];
}): boolean {
  if (message.role !== "user") {
    return false;
  }
  return message.parts.some((part) => {
    switch (part.type) {
      case "text": {
        return part.text.trim() !== "";
      }
      case "data-asks":
      case "data-fromChat": {
        return true;
      }
      case "data-attachments": {
        return (
          part.data.files.length > 0 || (part.data.folders?.length ?? 0) > 0
        );
      }
      default: {
        return false;
      }
    }
  });
}

function joinedMidTurn(message: TranscriptMessage): boolean {
  return message.parts.some(
    (part) =>
      part.type === "data-intent" && part.data.text.includes(MID_TURN_NOTE),
  );
}

interface BuildOptions {
  cutAcross: boolean;
  isDeveloperMode: boolean;
  isLive: boolean;
  lastMessage: TranscriptMessage | undefined;
  sessionId: StoreId.Session | undefined;
}

function buildTurn(
  first: TranscriptMessage,
  slice: readonly TranscriptMessage[],
  options: BuildOptions,
): Turn {
  const { cutAcross, isLive, sessionId } = options;
  const opener = opensTurn(first) ? openerOf(first, options) : undefined;
  const body = opener ? slice.slice(1) : slice;
  const rows = rowsOf(body, options);
  const replies = body.filter(
    (message): message is Turn["replies"][number] =>
      message.role === "assistant",
  );
  const phase = isLive
    ? "working"
    : !cutAcross && wasInterrupted(replies, rows)
      ? "interrupted"
      : "done";
  const endedAt = isLive ? undefined : lastEventAt(body);
  const activities = rows.filter(
    (row): row is ActivityRow => row.kind === "activity",
  );
  const sources = body.flatMap((message) =>
    message.parts.filter(
      (part): part is Turn["sources"][number] =>
        part.type === "source-document" || part.type === "source-url",
    ),
  );
  const summary = body
    .flatMap((message) => message.parts)
    .findLast((part) => part.type === "data-workSummary")?.data.words;
  const folded = foldedRows(rows, { cutAcross, phase });
  const startedAt = first.metadata.createdAt;
  return {
    apps: unique(activities.flatMap((row) => row.apps)),
    ...(endedAt && { endedAt }),
    foldedRowIds: folded.ids,
    foldsWhenDone: folded.whenDone,
    id: first.id,
    inherited:
      sessionId !== undefined && first.metadata.sessionId !== sessionId,
    ...(isLive && { live: liveOf(rows, body, first) }),
    ...(opener && { opener }),
    phase,
    replies,
    rows,
    sites: unique(activities.flatMap((row) => row.sites)),
    sources,
    startedAt,
    ...(summary !== undefined && { summary }),
    workedMs: workedMs(rows, startedAt),
  };
}

function openerOf(
  message: TranscriptMessage,
  { isDeveloperMode }: { isDeveloperMode: boolean },
): TurnOpener {
  const opener: TurnOpener = {
    chips: [],
    files: [],
    folders: [],
    joinedMidTurn: joinedMidTurn(message),
    message,
    notes: [],
  };
  for (const part of message.parts) {
    switch (part.type) {
      case "text": {
        if (part.text.trim() !== "" || part.state === "streaming") {
          opener.text = part;
        }
        break;
      }
      case "data-attachments": {
        opener.files = part.data.files;
        opener.folders = part.data.folders ?? [];
        break;
      }
      case "data-fromChat": {
        opener.fromChat = part.data;
        break;
      }
      case "data-viewContext": {
        opener.chips = part.data.attached ?? [];
        if (isDeveloperMode) {
          opener.notes.push(part);
        }
        break;
      }
      default: {
        if (isDataRow(part) && drawsNote(part, { isDeveloperMode })) {
          opener.notes.push(part);
        }
      }
    }
  }
  return opener;
}

function rowsOf(
  body: readonly TranscriptMessage[],
  { isDeveloperMode, lastMessage }: BuildOptions,
): TurnRow[] {
  const rows: TurnRow[] = [];
  const facts = factsByStep(body);
  let open: ActivityRow | undefined;
  // A model that retries a failed command says its line again first, and the
  // second copy is the same words twice.
  let lastSaid: string | undefined;

  const stepInto = (step: StepPart) => {
    if (joinsActivity(open, step)) {
      if (open.title === undefined && step.activity !== undefined) {
        open.title = step.activity;
      }
    } else {
      open = newActivity(step);
      rows.push(open);
    }
    addStep(open, step, facts.get(step.metadata.id));
  };

  for (const [index, message] of body.entries()) {
    if (message.role === "user") {
      // A wake. What it says is the app's, and what comes of it is the reply.
      open = undefined;
      for (const part of message.parts) {
        if (isDataRow(part) && drawsNote(part, { isDeveloperMode })) {
          rows.push({ id: part.metadata.id, kind: "note", part });
        }
      }
      continue;
    }
    const next = body[index + 1];
    const endedTurn = next?.role !== "assistant";
    const isLastMessage = message.id === lastMessage?.id;
    const error = message.metadata.error;
    const superseded = error?.kind === "aborted";
    const retriedAway =
      !isDeveloperMode &&
      isRetriedAway(message.metadata, { endedTurn, isLastMessage });
    for (const part of message.parts) {
      if (part.type === "text") {
        if (
          superseded ||
          retriedAway ||
          (part.state !== "streaming" && saysNothing(part.text))
        ) {
          continue;
        }
        const kept = withoutRepeat(part, lastSaid);
        if (!kept) {
          continue;
        }
        const said = part.text.trim();
        if (said !== "") {
          lastSaid = said;
        }
        open = undefined;
        rows.push({ id: kept.metadata.id, kind: "text", part: kept });
      } else if (isStepPart(part)) {
        const started = part.startedTasks ?? [];
        if (started.length === 0) {
          stepInto(part);
          continue;
        }
        // A task's card stands for the call that started it and ends the
        // activity above it. Calls after it open a new row.
        open = undefined;
        for (const sessionId of started) {
          rows.push({
            id: part.metadata.id,
            kind: "task",
            sessionId,
            startedAt: part.metadata.startedAt ?? part.metadata.createdAt,
          });
        }
      } else if (isAsk(part)) {
        open = undefined;
        rows.push({ id: part.metadata.id, kind: "ask", part });
      } else if (isDataRow(part) && drawsNote(part, { isDeveloperMode })) {
        rows.push({ id: part.metadata.id, kind: "note", part });
      }
    }
    if (
      error &&
      (isDeveloperMode || !superseded) &&
      !retriedAway &&
      (isDeveloperMode || !isSameRefusal(message, next))
    ) {
      open = undefined;
      rows.push({
        endedTurn,
        id: `error-${message.id}`,
        isLastMessage,
        kind: "error",
        message,
      });
    }
  }
  return rows;
}

/**
 * Whether a step belongs to the open activity: it says nothing of its own, it
 * says the same, it is the first name for a run of thoughts, or it is the
 * activity's name still being written.
 */
function joinsActivity(
  open: ActivityRow | undefined,
  step: StepPart,
): open is ActivityRow {
  if (!open) {
    return false;
  }
  const { activity } = step;
  return (
    activity === undefined ||
    activity === open.title ||
    (open.title === undefined && open.steps.every(isThought)) ||
    (step.status === "writing" && open.title?.startsWith(activity) === true)
  );
}

function isThought(step: StepPart): boolean {
  return step.tool === "reasoning";
}

function newActivity(step: StepPart): ActivityRow {
  return {
    apps: [],
    counts: [],
    id: step.metadata.id,
    kind: "activity",
    sites: [],
    startedAt: step.metadata.startedAt ?? step.metadata.createdAt,
    steps: [],
    ...(step.activity !== undefined && { title: step.activity }),
  };
}

function addStep(
  row: ActivityRow,
  step: StepPart,
  facts: SessionMessageDataPart.StepFactsDataPart | undefined,
) {
  row.steps.push({ ...step, ...(facts && { facts }) });
  const endedAt = step.metadata.endedAt;
  if (endedAt && (!row.endedAt || endedAt > row.endedAt)) {
    row.endedAt = endedAt;
  }
  if (!facts) {
    return;
  }
  row.apps = unique([...row.apps, ...facts.apps.map((call) => call.app)]);
  row.sites = unique([...row.sites, ...facts.hosts]);
  for (const counted of facts.counts) {
    const known = row.counts.find((each) => each.label === counted.label);
    if (known) {
      known.count += counted.count;
    } else {
      row.counts.unshift({ ...counted });
    }
  }
}

function factsByStep(body: readonly TranscriptMessage[]) {
  const facts = new Map<
    StoreId.Part,
    SessionMessageDataPart.StepFactsDataPart
  >();
  for (const message of body) {
    for (const part of message.parts) {
      if (part.type === "data-stepFacts") {
        facts.set(part.data.step, part.data);
      }
    }
  }
  return facts;
}

function isDataRow(part: TranscriptPart): part is SessionMessagePart.DataPart {
  return (
    part.type.startsWith("data-") &&
    part.type !== "data-stepFacts" &&
    part.type !== "data-workSummary"
  );
}

function isAsk(part: TranscriptPart): part is SessionMessagePart.ToolPart {
  return (
    part.type === "tool-choose" ||
    part.type === "tool-connect_app" ||
    part.type === "tool-offer_feedback"
  );
}

/**
 * Whether a note draws a row. Telling the agent what happened is not telling
 * the person: an app's or a task's news reaches them as the reply, unless
 * nothing is going to reply to it.
 */
function drawsNote(
  part: SessionMessagePart.DataPart,
  { isDeveloperMode }: { isDeveloperMode: boolean },
): boolean {
  const visibility = dataPartVisibility(part);
  if (visibility === "hidden") {
    return false;
  }
  if (isDeveloperMode) {
    return true;
  }
  if (visibility === "dev") {
    return false;
  }
  switch (part.type) {
    case "data-appEvent":
    // Drawn with the message it came on, or by the line above it.
    case "data-fromChat":
    case "data-modelChange": {
      return false;
    }
    case "data-taskEvent": {
      return part.data.events.some(
        (event) => event.stoppedBy === "app" || event.stoppedBy === "person",
      );
    }
    default: {
      return true;
    }
  }
}

/** The words with what the turn already said taken off the front. */
function withoutRepeat(
  part: SessionMessagePart.TextPart,
  lastSaid: string | undefined,
): SessionMessagePart.TextPart | undefined {
  const said = part.text.trim();
  if (lastSaid === undefined || said === "" || !said.startsWith(lastSaid)) {
    return part;
  }
  const rest = said.slice(lastSaid.length).trim();
  return rest === "" ? undefined : { ...part, text: rest };
}

/**
 * Whether finished words say nothing: blank, or only fence marks, which a
 * model that opened a code block and stopped leaves behind.
 */
function saysNothing(text: string): boolean {
  return /^[\s`~]*$/.test(text);
}

/**
 * Whether a reply failed in a way its turn went on past, with another of the
 * agent's messages after it, which is the retry: a throttle, a provider's
 * passing problem, or a refusal of media the retry left out, which the agent
 * tells the person about itself. A failure the turn ended on was never retried.
 */
function isRetriedAway(
  {
    error,
    refusedMedia,
  }: Pick<SessionMessage.Assistant["metadata"], "error" | "refusedMedia">,
  { endedTurn, isLastMessage }: { endedTurn: boolean; isLastMessage: boolean },
): boolean {
  const classification =
    error && "classification" in error ? error.classification : undefined;
  return (
    (classification === "rate-limit" ||
      classification === "transient" ||
      (refusedMedia?.length ?? 0) > 0) &&
    !isLastMessage &&
    !endedTurn
  );
}

/** A run of the same refusal, one per retry, reads as one: only the latest. */
function isSameRefusal(
  message: TranscriptMessage,
  next: TranscriptMessage | undefined,
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
 * A turn something ended before it finished: the person's Stop, a failure, or
 * the app closing on a call.
 */
function wasInterrupted(
  replies: readonly SessionMessage.Assistant[],
  rows: readonly TurnRow[],
): boolean {
  return (
    replies.at(-1)?.metadata.error !== undefined ||
    rows.some((row) => row.kind === "activity" && isRunningRow(row))
  );
}

function isRunningRow(row: ActivityRow): boolean {
  return row.steps.some(
    (step) =>
      step.status === "writing" ||
      step.status === "running" ||
      step.status === "queued",
  );
}

/**
 * Which rows the Worked row stands for. A turn that finished with words folds
 * everything before them. One a message cut across folds what it has finished,
 * since the agent went on to answer. Anything else stays open: a turn stopped
 * or failed partway is there to read. A task may still be running, and notes
 * and errors are things to read, so none of those is ever folded.
 */
function foldedRows(
  rows: readonly TurnRow[],
  {
    cutAcross,
    phase,
  }: { cutAcross: boolean; phase: "done" | "interrupted" | "working" },
): { ids: ReadonlySet<string>; whenDone: boolean } {
  const none = { ids: new Set<string>(), whenDone: false };
  const foldable = (row: TurnRow) =>
    row.kind === "ask" ||
    row.kind === "text" ||
    (row.kind === "activity" && !isRunningRow(row));
  if (cutAcross) {
    return {
      ids: new Set(rows.filter(foldable).map((row) => row.id)),
      whenDone: false,
    };
  }
  if (phase !== "done" || rows.findLast(foldable)?.kind !== "text") {
    return none;
  }
  // The reply is the words after the last step, however many parts they are.
  const lastWork = rows.findLastIndex(
    (row) => row.kind === "activity" || row.kind === "ask",
  );
  return lastWork === -1
    ? none
    : {
        ids: new Set(
          rows
            .slice(0, lastWork + 1)
            .filter(foldable)
            .map((row) => row.id),
        ),
        whenDone: true,
      };
}

function liveOf(
  rows: readonly TurnRow[],
  body: readonly TranscriptMessage[],
  first: TranscriptMessage,
): TurnLive {
  // An activity stays the working line between its calls, which is most of
  // its time: a browser's commands take a fraction of a second, with seconds of
  // the model thinking between them, and a line flipping to Thinking for each
  // would only flicker. It says Thinking before there is any work to name.
  const last = rows.findLast((row) => row.kind !== "note");
  if (last?.kind === "activity") {
    return { activityId: last.id, kind: "activity" };
  }
  if (last?.kind === "text" && last.part.state === "streaming") {
    return { kind: "writing" };
  }
  return {
    kind: "thinking",
    since: lastEventAt(body) ?? first.metadata.createdAt,
  };
}

/** When the last thing in these messages ended. */
function lastEventAt(messages: readonly TranscriptMessage[]): Date | undefined {
  let latest: Date | undefined;
  const see = (at: Date | undefined) => {
    if (at && (!latest || at > latest)) {
      latest = at;
    }
  };
  for (const message of messages) {
    see(message.metadata.createdAt);
    if (message.role === "assistant") {
      see(message.metadata.finishedAt);
    }
    for (const part of message.parts) {
      const { endedAt } = part.metadata;
      see(endedAt instanceof Date ? endedAt : undefined);
    }
  }
  return latest;
}

/** How long the turn worked: from its start to the end of its last activity. */
function workedMs(rows: readonly TurnRow[], startedAt: Date): number {
  const ends = rows.flatMap((row) =>
    row.kind === "activity" && row.endedAt ? [row.endedAt.getTime()] : [],
  );
  return ends.length === 0
    ? 0
    : Math.max(0, Math.max(...ends) - startedAt.getTime());
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
