import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type StoreId } from "../../schemas/store-id";
import { askedOnCard } from "../../tools/connect-app-output";
import { chooseAnswer } from "../choose-call";
import { MID_TURN_NOTE } from "../chat/mid-turn";
import { dataPartVisibility } from "../data-part-visibility";
import { type ErrorOutcome, errorOutcomeOf } from "./error-outcome";
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
  | {
      id: StoreId.Part;
      /** It still waits on the person, so it stays out of the fold. */
      isOpen: boolean;
      kind: "ask";
      part: SessionMessagePart.ToolPart;
    }
  | {
      /** What it draws: see `ErrorOutcome`. */
      draws: Exclude<ErrorOutcome["draws"], "none">;
      id: string;
      isLastMessage: boolean;
      /** Last, or above a retry that has said nothing yet, so what it says stands. */
      isLatestAttempt: boolean;
      kind: "error";
      message: TranscriptMessage & { role: "assistant" };
    }
  | { id: StoreId.Part; kind: "note"; part: SessionMessagePart.DataPart }
  | {
      /**
       * Where its stretch of the task's log starts: the message a send put
       * there. Absent on the card of the call that started the task, whose
       * stretch is the task's first.
       */
      from?: StoreId.Message;
      /**
       * The call's own part for the first task it started or sent work to,
       * so the card that comes up as the call arrives is the same row once
       * the task exists. A call reaching several tasks keys the rest by
       * their message or session.
       */
      id: StoreId.Message | StoreId.Part | StoreId.Session;
      kind: "task";
      /** The new task's name from its call, while the task does not exist yet. */
      name?: string;
      /** Absent while the call is still arriving or running and no task exists yet. */
      sessionId?: StoreId.Session;
      startedAt: Date;
      /** The call it stands for. */
      step: StoreId.Part;
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

type RatingCardPart = Extract<
  SessionMessagePart.DataPart,
  { type: "data-ratingCard" }
>;

type BranchedFromPart = Extract<
  SessionMessagePart.DataPart,
  { type: "data-branchedFrom" }
>;

/**
 * What the working line says of a turn in flight. `thought` is the thought
 * nothing has followed yet, which the line opens onto, since no row draws one.
 */
export type TurnLive =
  | { activityId: StoreId.Part; kind: "activity"; thought?: StepPart }
  | { kind: "thinking"; since: Date; thought?: StepPart }
  | { kind: "writing" };

/**
 * Everything since the message the person typed, or since a wake that came
 * once the agent had answered: a sign-in answered or a task finished carries
 * the work on in a turn of its own with no opener, below the answer it
 * follows. A wake while the agent is still at it stays in the turn. `rows` is
 * all of it; `foldedRowIds` says which of them the Worked row stands for once
 * the turn folds.
 */
export interface Turn {
  /** The apps its work reached. */
  apps: string[];
  /** On a branch's last copied turn, the chat it was copied from, drawn after the turn and its footer. */
  branchedFrom?: BranchedFromPart;
  /** When it stopped working and writing; absent while it works. */
  endedAt?: Date;
  /** The rows the Worked row stands for. Empty when the turn does not fold. */
  foldedRowIds: ReadonlySet<string>;
  /** The folded row the Worked row draws at: where the work starts, under what was said before it. */
  foldLineAt?: string;
  id: StoreId.Message;
  /** Taken over from the chat a task forked from, ahead of the task's own work. */
  inherited: boolean;
  /**
   * What woke the agent, for a turn a wake opens whose news draws no row of
   * its own: the line that says why the work goes on.
   */
  wokenBy?: WokenBy;
  live?: TurnLive;
  opener?: TurnOpener;
  phase: "done" | "interrupted" | "working";
  /** The card asking how it went, drawn after the turn and its footer. */
  ratingCard?: RatingCardPart;
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
  isRunning: boolean;
  /** The session being read; a task's history begins with its chat's messages. */
  sessionId?: StoreId.Session;
}

/** Each turn from an earlier call, kept while its messages stay the same objects. */
export type TurnsCache = Map<
  StoreId.Message,
  {
    cutAcross: boolean;
    /** It holds the session's last message, which its error row's actions read. */
    holdsLast: boolean;
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
  { isRunning, sessionId }: TurnsOfOptions,
  cache?: TurnsCache,
): Turn[] {
  const slices = turnSlices(messages);
  const lastMessage = messages.at(-1);
  // A wake carrying a turn on is not the person writing past it.
  const lastTyped = slices.findLastIndex(
    ([first]) => first !== undefined && opensTurn(first),
  );
  return slices.flatMap((slice, index) => {
    const [first] = slice;
    if (!first) {
      return [];
    }
    const next = slices[index + 1]?.[0];
    const cutAcross = next !== undefined && joinedMidTurn(next);
    // A message sent during a step opens the next turn before the agent has
    // read it, and until then that step is still going in this one.
    const isLive =
      isRunning &&
      (next === undefined ||
        (index === slices.length - 2 &&
          !cutAcross &&
          slice.some(isStillGoing)));
    const holdsLast = index >= lastTyped;
    const kept = cache?.get(first.id);
    if (
      kept &&
      kept.isLive === isLive &&
      kept.cutAcross === cutAcross &&
      // Being followed tells an error it is not the last message and closes
      // a question written past.
      (kept.holdsLast === holdsLast ||
        !kept.turn.rows.some(
          (row) => row.kind === "error" || (row.kind === "ask" && row.isOpen),
        )) &&
      kept.slice.length === slice.length &&
      kept.slice.every((message, at) => message === slice[at])
    ) {
      return [kept.turn];
    }
    const turn = buildTurn(first, slice, {
      cutAcross,
      isLive,
      lastMessage,
      sessionId,
      writtenPast: !holdsLast,
    });
    cache?.set(first.id, { cutAcross, holdsLast, isLive, slice, turn });
    return [turn];
  });
}

/**
 * Whether a turn is folded at this moment: it folds (see `foldedRows`), and
 * either its summary has arrived or it has waited long enough for it.
 */
export function isTurnFolded(turn: Turn, now: number): boolean {
  if (turn.foldedRowIds.size === 0) {
    return false;
  }
  return (
    turn.summary !== undefined ||
    (turn.endedAt !== undefined && now - turn.endedAt.getTime() >= FOLD_WAIT_MS)
  );
}

/**
 * Whether the last turn's message is waiting on a step still going in the turn
 * before it. The agent reads it when that step ends, and it joins that turn then.
 */
export function waitsForStep(turns: readonly Turn[]): boolean {
  const last = turns.at(-1);
  return (
    last?.live?.kind === "thinking" &&
    last.rows.length === 0 &&
    turns
      .at(-2)
      ?.rows.some(
        (row) =>
          (row.kind === "activity" && isRunningRow(row)) ||
          (row.kind === "text" && row.part.state === "streaming"),
      ) === true
  );
}

/**
 * The messages cut into turns: each message a person typed opens one, and what
 * follows belongs to it until the next. A wake after the turn ended in words
 * (a task finished, a permission or sign-in answered) opens one of its own
 * with no opener, which carries the work on below what was already shown, so
 * a turn that ended and folded stays as it was.
 */
function turnSlices<T extends TranscriptMessage>(
  messages: readonly T[],
): T[][] {
  const slices: T[][] = [];
  for (const message of messages) {
    const current = slices.at(-1);
    if (
      !current ||
      opensTurn(message) ||
      (isWake(message) && endedInWords(current))
    ) {
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

/**
 * Whether a message is the app waking the agent: a user message other than a
 * branch's note on its copied history, counted from before its parts arrive,
 * since a message is written ahead of them.
 */
function isWake(message: TranscriptMessage): boolean {
  return (
    message.role === "user" &&
    (message.parts.length === 0 ||
      message.parts.some((part) => part.type !== "data-branchedFrom"))
  );
}

/** Whether the newest of a turn's messages ended with words the agent finished saying. */
function endedInWords(slice: readonly TranscriptMessage[]): boolean {
  const last = slice.findLast((message) => message.role === "assistant");
  if (!last || last !== slice.at(-1) || isStillGoing(last)) {
    return false;
  }
  const said = last.parts.findLast(
    (part) => part.type === "text" || isStepPart(part),
  );
  return said?.type === "text" && !saysNothing(said.text);
}

/** Whether a message has a step or words the agent is still on. */
function isStillGoing(message: TranscriptMessage): boolean {
  return message.parts.some((part) =>
    part.type === "text"
      ? part.state === "streaming"
      : isStepPart(part) && isRunningStep(part),
  );
}

function joinedMidTurn(message: TranscriptMessage): boolean {
  return message.parts.some(
    (part) =>
      part.type === "data-intent" && part.data.text.includes(MID_TURN_NOTE),
  );
}

/** What a wake that opens a turn says happened. */
type WokenBy =
  | { kind: "signed-in" }
  | {
      count: number;
      kind: "task-checked-on" | "task-failed" | "task-finished";
    };

/**
 * What woke the agent at the head of a turn a wake opens, when no note row
 * says so already: a task's news reaches the person as the reply, and a sign-in
 * finishing as the work it unblocked.
 */
function wokenByOf(message: TranscriptMessage): WokenBy | undefined {
  for (const part of message.parts) {
    if (
      part.type === "data-taskEvent" &&
      part.data.events.length > 0 &&
      !drawsNote(part)
    ) {
      const { events } = part.data;
      const kind = events.some((event) => event.status === "error")
        ? "task-failed"
        : events.every((event) => event.status === "overdue")
          ? "task-checked-on"
          : "task-finished";
      return { count: events.length, kind };
    }
    if (
      part.type === "data-appEvent" &&
      part.data.events.some(({ event }) => event === "connected")
    ) {
      return { kind: "signed-in" };
    }
  }
  return undefined;
}

interface BuildOptions {
  cutAcross: boolean;
  /** A message the person typed comes after this turn. */
  writtenPast: boolean;
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
  const opener = opensTurn(first) ? openerOf(first) : undefined;
  const wokenBy = opener ? undefined : wokenByOf(first);
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
  const ratingCard = body
    .flatMap((message) => message.parts)
    .find(isShownRatingCard);
  const branchedFrom = body
    .flatMap((message) => message.parts)
    .find(
      (part): part is BranchedFromPart => part.type === "data-branchedFrom",
    );
  return {
    apps: unique(activities.flatMap((row) => row.apps)),
    ...(branchedFrom && { branchedFrom }),
    ...(endedAt && { endedAt }),
    foldedRowIds: folded.ids,
    ...(folded.lineAt !== undefined && { foldLineAt: folded.lineAt }),
    id: first.id,
    inherited:
      sessionId !== undefined && first.metadata.sessionId !== sessionId,
    ...(isLive && { live: liveOf(rows, body, first) }),
    ...(opener && { opener }),
    phase,
    ...(ratingCard && { ratingCard }),
    replies,
    rows,
    sites: unique(activities.flatMap((row) => row.sites)),
    sources,
    startedAt,
    ...(wokenBy && { wokenBy }),
    ...(summary !== undefined && { summary }),
    workedMs: workedMs(rows, startedAt),
  };
}

function openerOf(message: TranscriptMessage): TurnOpener {
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
        break;
      }
      default: {
        if (isDataRow(part) && drawsNote(part)) {
          opener.notes.push(part);
        }
      }
    }
  }
  return opener;
}

function rowsOf(
  body: readonly TranscriptMessage[],
  { isLive, lastMessage, writtenPast }: BuildOptions,
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
      // A wake. What it says is the app's, and what comes of it is the reply,
      // which may well be the same words as before it.
      open = undefined;
      lastSaid = undefined;
      for (const part of message.parts) {
        if (isDataRow(part) && drawsNote(part)) {
          rows.push({ id: part.metadata.id, kind: "note", part });
        }
      }
      continue;
    }
    const next = body[index + 1];
    const isLastMessage = message.id === lastMessage?.id;
    const isLatestAttempt =
      isLastMessage ||
      (next?.id === lastMessage?.id &&
        next?.role === "assistant" &&
        !next.metadata.error &&
        next.parts.length === 0);
    const outcome = errorOutcomeOf(message, {
      isLive,
      lastMessageId: lastMessage?.id,
      next,
    });
    // Its words went with it: the retry says them whole.
    const retriedAway = outcome?.cause.startsWith("Retried:") === true;
    for (const part of message.parts) {
      if (part.type === "text") {
        if (retriedAway || saysNothing(part.text)) {
          continue;
        }
        const kept = withoutRepeat(part, lastSaid);
        if (!kept) {
          continue;
        }
        lastSaid = part.text.trim();
        open = undefined;
        rows.push({ id: kept.metadata.id, kind: "text", part: kept });
      } else if (isStepPart(part)) {
        // One going on is Thinking, and one that ended leaves nothing behind.
        if (isThought(part)) {
          continue;
        }
        const started = part.startedTasks ?? [];
        const sent = part.sentTasks ?? [];
        // A call that starts a task or sends one work is its card from the
        // moment its command arrives. One that ended reaching no task (a
        // refusal, its help, a send from before sends named their message)
        // is a step like any other.
        const pending =
          started.length === 0 &&
          sent.length === 0 &&
          part.startsTask !== undefined &&
          (part.status === "queued" ||
            part.status === "running" ||
            part.status === "writing");
        if (started.length === 0 && sent.length === 0 && !pending) {
          stepInto(part);
          continue;
        }
        // A task's card stands for the call that started it or sent it work,
        // and ends the activity above it. Calls after it open a new row.
        open = undefined;
        const startedAt = part.metadata.startedAt ?? part.metadata.createdAt;
        const step = part.metadata.id;
        const cards: TurnRow[] = [
          ...started.map((sessionId) => ({
            id: sessionId,
            kind: "task" as const,
            sessionId,
            startedAt,
            step,
          })),
          ...sent.map(({ messageId, sessionId }) => ({
            from: messageId,
            id: messageId,
            kind: "task" as const,
            sessionId,
            startedAt,
            step,
          })),
        ];
        const [first, ...rest] = pending
          ? [
              {
                id: step,
                kind: "task" as const,
                ...(part.startsTask?.name !== undefined && {
                  name: part.startsTask.name,
                }),
                startedAt,
                step,
              },
            ]
          : cards;
        if (first) {
          rows.push({ ...first, id: step }, ...rest);
        }
      } else if (isAsk(part)) {
        open = undefined;
        rows.push({
          id: part.metadata.id,
          isOpen: stillAsks(part, body.slice(index + 1), writtenPast),
          kind: "ask",
          part,
        });
      } else if (isDataRow(part) && drawsNote(part)) {
        rows.push({ id: part.metadata.id, kind: "note", part });
      }
    }
    if (outcome && outcome.draws !== "none") {
      open = undefined;
      rows.push({
        draws: outcome.draws,
        id: `error-${message.id}`,
        isLastMessage,
        isLatestAttempt,
        kind: "error",
        message,
      });
    }
  }
  return rows;
}

/**
 * Whether a step belongs to the open activity: it says nothing of its own, it
 * says the same, or it is the activity's name still being written.
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
    part.type !== "data-ratingCard" &&
    part.type !== "data-stepFacts" &&
    part.type !== "data-workSummary"
  );
}

/** The card asking how a turn went, unless the person closed it. */
function isShownRatingCard(part: TranscriptPart): part is RatingCardPart {
  return part.type === "data-ratingCard" && part.data.outcome !== "dismissed";
}

/**
 * Whether a card still waits on the person, read from what the turn went on to
 * record: a question not answered yet, or a sign-in with an app on its card not
 * settled yet. What a sign-in asked is on its call whatever became of it, so
 * the events after it are what say it is over.
 */
function stillAsks(
  part: SessionMessagePart.ToolPart,
  later: readonly TranscriptMessage[],
  writtenPast: boolean,
): boolean {
  switch (part.type) {
    case "tool-choose": {
      // The call ends as the card goes up and the answer is written onto it;
      // a message the person typed after it closes it unanswered.
      return (
        !writtenPast &&
        (part.state !== "output-available" ||
          chooseAnswer(part.output) === undefined)
      );
    }
    case "tool-connect_app": {
      if (part.state !== "output-available") {
        return true;
      }
      const settled = new Set(later.flatMap(appsSettledBy));
      return askedOnCard(part.output).some((app) => !settled.has(app.slug));
    }
    default: {
      return false;
    }
  }
}

/**
 * The apps a message's events finish with. A failed sign-in leaves its card up
 * to try again, and other news of an app leaves the question of signing in open.
 */
function appsSettledBy(message: TranscriptMessage): string[] {
  return message.parts.flatMap((part) =>
    part.type === "data-appEvent"
      ? part.data.events.flatMap(({ event, slug }) =>
          event === "connected" || event === "declined" || event === "removed"
            ? [slug]
            : [],
        )
      : [],
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
function drawsNote(part: SessionMessagePart.DataPart): boolean {
  if (dataPartVisibility(part) !== "always") {
    return false;
  }
  switch (part.type) {
    case "data-appEvent":
    // Drawn after the turn's footer.
    case "data-branchedFrom":
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

/**
 * The words with what the turn already said taken off the front, and nothing
 * while words still arriving are only the start of what it said: drawn, a line
 * said again would type itself out and vanish as it finished.
 */
function withoutRepeat(
  part: SessionMessagePart.TextPart,
  lastSaid: string | undefined,
): SessionMessagePart.TextPart | undefined {
  const said = part.text.trim();
  if (lastSaid === undefined) {
    return part;
  }
  if (part.state === "streaming" && lastSaid.startsWith(said)) {
    return undefined;
  }
  if (!said.startsWith(lastSaid)) {
    return part;
  }
  const rest = said.slice(lastSaid.length).trim();
  return rest === "" ? undefined : { ...part, text: rest };
}

/**
 * Whether words say nothing, so far or at all: blank, or only fence marks, which
 * a model that opened a code block and stopped leaves behind. They draw no row
 * until they say something, so a reply starting changes nothing on the page.
 */
function saysNothing(text: string): boolean {
  return /^[\s`~]*$/.test(text);
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

function isRunningStep(step: StepPart): boolean {
  return (
    step.status === "writing" ||
    step.status === "running" ||
    step.status === "queued"
  );
}

function isRunningRow(row: ActivityRow): boolean {
  return row.steps.some(isRunningStep);
}

/**
 * Which rows the Worked row stands for: all of a turn's work or none of it.
 * It folds only when nothing in it is left to read, so the reply after it is
 * the whole of what the person needs: the turn finished on its own with
 * words, no message cut across it, and every row between the first piece of
 * work and the reply is a finished step, a card already answered, or words
 * said along the way. A note, an error, a task, a step still running or a
 * card still waiting keeps the whole turn open. What the agent said before
 * it did anything answers the message at once, so it stays above the fold.
 */
function foldedRows(
  rows: readonly TurnRow[],
  {
    cutAcross,
    phase,
  }: { cutAcross: boolean; phase: "done" | "interrupted" | "working" },
): { ids: ReadonlySet<string>; lineAt: string | undefined } {
  const none = { ids: new Set<string>(), lineAt: undefined };
  const isWork = (row: TurnRow) =>
    row.kind === "activity" || row.kind === "ask";
  const firstWork = rows.findIndex(isWork);
  const lastWork = rows.findLastIndex(isWork);
  if (
    cutAcross ||
    phase !== "done" ||
    firstWork === -1 ||
    rows.at(-1)?.kind !== "text"
  ) {
    return none;
  }
  const work = rows.slice(firstWork, lastWork + 1);
  const isSettled = (row: TurnRow) =>
    row.kind === "text" ||
    (row.kind === "ask" && !row.isOpen) ||
    (row.kind === "activity" && !isRunningRow(row));
  const isWords = (row: TurnRow) => row.kind === "text";
  if (
    !rows.slice(0, firstWork).every(isWords) ||
    !work.every(isSettled) ||
    !rows.slice(lastWork + 1).every(isWords)
  ) {
    return none;
  }
  return { ids: new Set(work.map((row) => row.id)), lineAt: work[0]?.id };
}

function liveOf(
  rows: readonly TurnRow[],
  body: readonly TranscriptMessage[],
  first: TranscriptMessage,
): TurnLive {
  const thought = thoughtGoingOn(body);
  const opens = thought && { thought };
  // An activity stays the working line between its calls, which is most of
  // its time: a browser's commands take a fraction of a second, with seconds of
  // the model thinking between them, and a line flipping to Thinking for each
  // would only flicker. It says Thinking before there is any work to name.
  const last = rows.findLast((row) => row.kind !== "note");
  if (last?.kind === "activity") {
    return { activityId: last.id, kind: "activity", ...opens };
  }
  if (last?.kind === "text" && last.part.state === "streaming") {
    return { kind: "writing" };
  }
  return {
    kind: "thinking",
    since: lastEventAt(body) ?? first.metadata.createdAt,
    ...opens,
  };
}

/** The thought the last message ends on, when no words or call have followed it. */
function thoughtGoingOn(
  body: readonly TranscriptMessage[],
): StepPart | undefined {
  const last = body.at(-1);
  if (last?.role !== "assistant") {
    return undefined;
  }
  const part = last.parts.findLast(
    (each) => each.type === "text" || isStepPart(each),
  );
  return part && isStepPart(part) && isThought(part) ? part : undefined;
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
      if (isStepPart(part) && isThought(part)) {
        continue;
      }
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
