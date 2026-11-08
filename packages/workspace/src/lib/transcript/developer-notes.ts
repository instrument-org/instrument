import { sort } from "radashi";

import { SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type StoreId } from "../../schemas/store-id";
import { dataPartVisibility } from "../data-part-visibility";
import { errorOutcomeOf } from "./error-outcome";
import {
  isStepPart,
  thoughtText,
  transcriptMessage,
} from "./transcript-message";
import { type TurnRow, turnsOf } from "./turns-of";

/** What a margin note stands for. */
type DeveloperNoteKind = "error" | "note" | "replaced" | "thought";

/** The icon a note wears, by what it stands for. */
type DeveloperNoteMark =
  | "apps"
  | "chats"
  | "command"
  | "computer"
  | "cut"
  | "dictation"
  | "error"
  | "file"
  | "files"
  | "folder"
  | "instructions"
  | "limit"
  | "memory"
  | "model"
  | "note"
  | "once"
  | "permission"
  | "project"
  | "question"
  | "replaced"
  | "screen"
  | "skill"
  | "tabs"
  | "task"
  | "thought"
  | "time";

/** The kind of row a note sits level with, whose first line sets its offset. */
type DeveloperNoteRowKind = "bubble" | TurnRow["kind"];

/**
 * One thing a developer reads beside the transcript rather than in it. Worked
 * out from the session's records, apart from the rows everyone gets.
 */
export interface DeveloperNote {
  id: string;
  kind: DeveloperNoteKind;
  label: string;
  mark: DeveloperNoteMark;
  /** The turn whose Worked row stands for its row once that closes. */
  foldedIn?: StoreId.Message;
  /** The row it sits level with, by its `data-transcript-row`. */
  row: string;
  rowKind: DeveloperNoteRowKind;
  /** What that row says, for a list of a fold's notes. */
  rowLabel: string;
  side: "left" | "right";
  turn: StoreId.Message;
}

/** What a note's card shows. */
export interface DeveloperNoteBody {
  /** The part's own data, for a part with no words the model read. */
  detail?: string;
  /** The words, as the model read them when it did. */
  text?: string;
  /** Whether a request carried it. */
  wasSent: boolean;
}

type Said = Pick<DeveloperNote, "id" | "kind" | "label" | "mark" | "side"> & {
  body: DeveloperNoteBody;
};

type Place = Pick<DeveloperNote, "row" | "rowKind" | "rowLabel">;

type NoteOptions = {
  sessionId: StoreId.Session;
} & Pick<
  SessionMessage.ModelNoteOptions,
  "attachmentsDir" | "shellPath" | "workspaceRoot"
>;

/** Parts the app reads to draw a row, which say nothing of their own. */
const NEVER_NOTES = new Set<SessionMessagePart.DataPart["type"]>([
  "data-ratingCard",
  "data-stepFacts",
  "data-workSummary",
]);

const STATE_PARTS = new Set<SessionMessagePart.DataPart["type"]>([
  "data-browserStatus",
  "data-project",
  "data-viewContext",
  "data-workspaceInstructions",
]);

const MARK_OF_PART: Record<
  SessionMessagePart.DataPart["type"],
  DeveloperNoteMark
> = {
  "data-appEvent": "apps",
  "data-asks": "files",
  "data-attachments": "files",
  "data-backgroundProcesses": "command",
  "data-branchedFrom": "chats",
  "data-browserStatus": "tabs",
  "data-chatContext": "chats",
  "data-contextRollover": "cut",
  "data-dateChange": "time",
  "data-environmentChange": "computer",
  "data-fileChanges": "file",
  "data-folderChanges": "folder",
  "data-fromChat": "chats",
  "data-intent": "once",
  "data-jobEvent": "command",
  "data-maxSteps": "limit",
  "data-memory": "memory",
  "data-messageGap": "time",
  "data-modelChange": "model",
  "data-outputLimit": "limit",
  "data-pageTakeover": "tabs",
  "data-permissionAnswer": "permission",
  "data-project": "project",
  "data-questionAnswer": "question",
  "data-ratingCard": "note",
  "data-requestFailure": "error",
  "data-requestNote": "once",
  "data-setupChanges": "skill",
  "data-setupNews": "skill",
  "data-signedIn": "apps",
  "data-skillMentions": "skill",
  "data-stepFacts": "note",
  "data-taskEvent": "task",
  "data-toolResultsCleared": "cut",
  "data-unknown": "note",
  "data-viewContext": "screen",
  "data-workSummary": "note",
  "data-workspaceInstructions": "instructions",
};

const FIRST_WORDS = 60;

const rowOfError = (row: TurnRow): Place => ({
  row: row.id,
  rowKind: "error",
  rowLabel: "Error",
});

const isDataPart = (
  part: SessionMessagePart.Type,
): part is SessionMessagePart.DataPart => part.type.startsWith("data-");

function firstWords(text: string): string {
  return (text.trim().split("\n")[0] ?? "").slice(0, FIRST_WORDS);
}

function noteName(type: string): string {
  return type
    .replace(/^data-/, "")
    .replaceAll(/([A-Z])/g, " $1")
    .toLowerCase();
}

function awayFor(minutes: number): string {
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  return days > 0
    ? `${days.toString()}d ${hours.toString()}h`
    : hours > 0
      ? `${hours.toString()}h ${(minutes % 60).toString()}m`
      : `${minutes.toString()}m`;
}

const ENVIRONMENT_NAMES: Record<string, string> = {
  appsFolder: "Apps folder",
  commands: "Commands",
  computer: "Computer",
  homeFolder: "Home folder",
  imageOptions: "Image options",
  outputFolder: "Output folder",
  platform: "Platform",
  timeZone: "Time zone",
  workspaceSkillsFolder: "Skills folder",
};

const REQUEST_NOTE_NAMES: Record<
  SessionMessageDataPart.RequestNoteDataPart["kind"],
  string
> = {
  budget: "Budget notice",
  correction: "Correction",
  "output-limit": "Output limit note",
  rollover: "Rollover notice",
  turn: "Turn note",
};

const named = (name: string, value: string) => `${name}: ${firstWords(value)}`;

/** The first few names of a list, and how many more. */
function someOf(names: readonly string[]): string {
  const [first, ...rest] = names;
  return `${first ?? ""}${rest.length > 0 ? ` +${rest.length.toString()}` : ""}`;
}

/**
 * A note's plain name and a bit of its data, read from the part. A count only
 * where a count is the data.
 */
function labelOfPart(part: SessionMessagePart.DataPart): string {
  switch (part.type) {
    case "data-appEvent": {
      return named(
        "Apps",
        someOf(part.data.events.map((one) => `${one.name} ${one.event}`)),
      );
    }
    case "data-asks": {
      return named(
        "Places marked",
        someOf(part.data.asks.map((ask) => ask.file.name)),
      );
    }
    case "data-attachments": {
      return named(
        "Files sent",
        someOf(part.data.files.map((file) => file.filename)),
      );
    }
    case "data-backgroundProcesses": {
      return named(
        "Commands running",
        someOf(part.data.running.map((one) => one.command)),
      );
    }
    case "data-browserStatus": {
      return `Browser tabs: ${part.data.tabs.length.toString()}`;
    }
    case "data-chatContext": {
      return `Other chats: ${part.data.chats.length.toString()}`;
    }
    case "data-contextRollover": {
      return `Context rollover: ${part.data.droppedMessages.toString()} dropped`;
    }
    case "data-dateChange": {
      return named("Today's date", part.data.date);
    }
    case "data-environmentChange": {
      const [name, value] = Object.entries(part.data)[0] ?? [];
      return name === undefined
        ? "Environment"
        : named(ENVIRONMENT_NAMES[name] ?? name, String(value));
    }
    case "data-fileChanges": {
      return "File changes";
    }
    case "data-folderChanges": {
      return named(
        "Folders",
        someOf(
          [...part.data.added, ...part.data.removed].map((one) => one.path),
        ),
      );
    }
    case "data-branchedFrom": {
      return named("Branched from", part.data.title);
    }
    case "data-fromChat": {
      return named("From the chat", part.data.text);
    }
    case "data-intent": {
      return named("Instruction", part.data.text);
    }
    case "data-jobEvent": {
      return named(
        "Command ended",
        someOf(part.data.events.map((one) => one.id)),
      );
    }
    case "data-maxSteps": {
      return `Step limit: ${part.data.maxStepCount.toString()}`;
    }
    case "data-memory": {
      return part.data.tells === "changes"
        ? named(
            "Memory changed",
            someOf([
              ...part.data.memories.map((one) => one.name),
              ...part.data.forgotten,
            ]),
          )
        : `Memories: ${(part.data.memories.length + part.data.more).toString()}`;
    }
    case "data-messageGap": {
      return `Time away: ${awayFor(part.data.minutes)}`;
    }
    case "data-modelChange": {
      return named("Model", part.data.to.name ?? part.data.to.modelId);
    }
    case "data-outputLimit": {
      return `Output limit: ${part.data.continuations.toString()} in a row`;
    }
    case "data-pageTakeover": {
      return named(
        part.data.stage === "taken" ? "Taken over" : "Given back",
        part.data.page.url,
      );
    }
    case "data-permissionAnswer": {
      return named(`Permission ${part.data.answer}`, part.data.target);
    }
    case "data-project": {
      return named("Project", part.data.project?.name ?? "None");
    }
    case "data-questionAnswer": {
      return named("Answer", part.data.questions[0] ?? "");
    }
    case "data-ratingCard":
    case "data-stepFacts":
    case "data-workSummary": {
      return noteName(part.type);
    }
    case "data-requestFailure": {
      return "Failed before sending";
    }
    case "data-requestNote": {
      return REQUEST_NOTE_NAMES[part.data.kind];
    }
    case "data-setupChanges":
    case "data-setupNews": {
      return named(
        "Setup changed",
        someOf(part.data.changes.map((one) => one.name)),
      );
    }
    case "data-signedIn": {
      return "Signed in";
    }
    case "data-skillMentions": {
      return named("Skills named", someOf(part.data.names));
    }
    case "data-taskEvent": {
      return named(
        "Task ended",
        someOf(part.data.events.map((one) => one.title)),
      );
    }
    case "data-toolResultsCleared": {
      return `Tool results cleared: ${part.data.results.toString()}`;
    }
    case "data-unknown": {
      return named("Unreadable", part.data.originalType.replace(/^data-/, ""));
    }
    case "data-viewContext": {
      const { app, chat, file, folder, page, screen } = part.data;
      return named(
        "On screen",
        file?.name ??
          page?.title ??
          page?.url ??
          app?.name ??
          chat?.title ??
          folder?.display ??
          screen,
      );
    }
    case "data-workspaceInstructions": {
      return named("Workspace instructions", part.data.file);
    }
    default: {
      part satisfies never;
      return noteName((part as SessionMessagePart.DataPart).type);
    }
  }
}

/**
 * A part's label, or its name when its data isn't the shape this build reads:
 * a part is cast on read, so one written by an older build can get this far.
 */
function labelOf(part: SessionMessagePart.DataPart): string {
  try {
    return labelOfPart(part);
  } catch {
    return noteName(part.type);
  }
}

/** What a row says, as a list of notes heads it. */
function rowLabelOf(row: TurnRow): string {
  switch (row.kind) {
    case "activity": {
      return row.title ?? row.steps.at(-1)?.explanation ?? "Work";
    }
    case "ask": {
      return "Question";
    }
    case "error": {
      return "Error";
    }
    case "note": {
      return noteName(row.part.type);
    }
    case "task": {
      return "Task";
    }
    case "text": {
      return firstWords(row.part.text);
    }
  }
}

/** The row each stored part draws in, for the rows that stand for a part. */
function rowsByPart(
  rows: readonly TurnRow[],
  startedTask: ReadonlyMap<string, StoreId.Part>,
): Map<string, Place> {
  const found = new Map<string, Place>();
  for (const row of rows) {
    const place = {
      row: row.id,
      rowKind: row.kind,
      rowLabel: rowLabelOf(row),
    };
    switch (row.kind) {
      case "activity": {
        for (const step of row.steps) {
          found.set(step.metadata.id, place);
        }
        break;
      }
      case "task": {
        const step = startedTask.get(row.sessionId);
        if (step !== undefined) {
          found.set(step, place);
        }
        break;
      }
      case "error": {
        break;
      }
      default: {
        found.set(row.id, place);
      }
    }
  }
  return found;
}

/**
 * The notes a session's records come to, oldest first, each with the row it
 * sits level with and what its card shows. A note stays beside what already
 * existed when it went out: its own row if it draws one, else the nearest row
 * before it, else the turn's message, so nothing that arrives later moves it.
 * The one thing that does is its row going away, as a retried attempt's does.
 * A session whose first turn opens on a wake has nothing yet for a note to sit
 * beside, so one there isn't drawn. Everything here is left out of the rows, so
 * what a developer reads costs nothing in what everyone reads.
 *
 * What a note's card says the model read comes from the walk a request makes
 * (`SessionMessage.toUIMessages`), which tells this each note as it goes onto a
 * user turn, so a card can't say anything the request wouldn't. What a run
 * recorded on a step of its own reaches the model on the next message, and until
 * then its card says it wasn't sent.
 *
 * Its side is who it came from: what the app told the model on the right, and on
 * the left what the agent did. A note on the agent's message that has only the
 * person's message to sit by went out with that message, so it reads on the right.
 *
 * The same records always give the same notes, and a whole session gives them
 * however few of its turns are on screen.
 */
export function developerNotesWithBodies(
  messages: readonly SessionMessage.WithParts[],
  { sessionId, ...modelOptions }: NoteOptions,
): { bodies: Map<string, DeveloperNoteBody>; notes: DeveloperNote[] } {
  const stored = messages.filter(
    (message) => message.role === "assistant" || message.role === "user",
  );
  const heard = new Map<string, SessionMessage.ModelNote>();
  const carriedOn = new Map<string, SessionMessage.ModelNote[]>();
  SessionMessage.toUIMessages(stored, {
    ...modelOptions,
    onNote: (note) => {
      if (note.part) {
        heard.set(note.part.metadata.id, note);
      }
      carriedOn.set(note.carriedOn, [
        ...(carriedOn.get(note.carriedOn) ?? []),
        note,
      ]);
    },
  });

  const light = stored.flatMap((message) => transcriptMessage(message) ?? []);
  const lightById = new Map(light.map((message) => [message.id, message]));
  const turns = turnsOf(light, { isRunning: false, sessionId });
  const startedTask = new Map<string, StoreId.Part>();
  for (const message of light) {
    for (const part of message.parts) {
      if (isStepPart(part)) {
        for (const task of part.startedTasks ?? []) {
          startedTask.set(task, part.metadata.id);
        }
      }
    }
  }

  const startOf = new Map(stored.map((message, at) => [message.id, at]));
  const notes: DeveloperNote[] = [];
  const bodies = new Map<string, DeveloperNoteBody>();

  for (const [at, turn] of turns.entries()) {
    const next = turns[at + 1];
    const body = stored.slice(
      startOf.get(turn.id) ?? 0,
      next ? startOf.get(next.id) : undefined,
    );
    const rowOfPart = rowsByPart(turn.rows, startedTask);
    // What a note with no row of its own sits by, as the turn is read in order.
    let nearest: Place | undefined = turn.opener && {
      row: `message:${turn.id}`,
      rowKind: "bubble",
      rowLabel: firstWords(
        turn.opener.text?.text ?? turn.opener.fromChat?.text ?? "Message",
      ),
    };
    const inThisTurn: DeveloperNote[] = [];

    const place = (note: Said) => {
      if (!nearest) {
        return;
      }
      bodies.set(note.id, note.body);
      inThisTurn.push({
        ...(turn.foldedRowIds.has(nearest.row) && { foldedIn: turn.id }),
        id: note.id,
        kind: note.kind,
        label: note.label,
        mark: note.mark,
        row: nearest.row,
        rowKind: nearest.rowKind,
        rowLabel: nearest.rowLabel,
        side:
          note.kind === "note" && nearest.rowKind === "bubble"
            ? "right"
            : note.side,
        turn: turn.id,
      });
    };

    for (const each of body) {
      // What dictated words add to this message, which no part stands for.
      for (const [index, note] of (carriedOn.get(each.id) ?? []).entries()) {
        if (!note.part) {
          place({
            body: { text: note.text, wasSent: true },
            id: `said-${each.id}-${index.toString()}`,
            kind: "note",
            label: "Dictation",
            mark: "dictation",
            side: "right",
          });
        }
      }
      for (const part of each.parts) {
        const own = rowOfPart.get(part.metadata.id);
        if (own) {
          nearest = own;
        }
        const said = noteOfPart(part, each, { hasRow: own !== undefined });
        if (said) {
          place({
            ...said,
            side:
              each.role === "user" && said.kind !== "error" ? "right" : "left",
          });
        }
      }
      const lightMessage = lightById.get(each.id);
      const lightAt = lightMessage ? light.indexOf(lightMessage) : -1;
      const outcome =
        lightMessage &&
        errorOutcomeOf(lightMessage, {
          isLive: false,
          lastMessageId: light.at(-1)?.id,
          next: light[lightAt + 1],
        });
      if (outcome && each.role === "assistant") {
        // Whatever a customer sees of it, this is where a developer reads it:
        // its cause, and everything the provider said.
        const row = turn.rows.find(
          (candidate) =>
            candidate.kind === "error" && candidate.message.id === each.id,
        );
        if (row) {
          nearest = rowOfError(row);
        }
        place({
          body: {
            detail: JSON.stringify(each.metadata.error, null, 2),
            wasSent: false,
          },
          id: `error-${each.id}`,
          kind: "error",
          label: outcome.cause,
          mark: "error",
          side: "left",
        });
      }
    }

    // In the order they draw, and on one row in the order they happened.
    const rowIndex = (note: DeveloperNote) =>
      turn.rows.findIndex((row) => row.id === note.row);
    notes.push(...sort(inThisTurn, rowIndex));
  }
  return { bodies, notes };

  /** What a stored part says beside the transcript, or nothing. */
  function noteOfPart(
    part: SessionMessagePart.Type,
    message: SessionMessage.WithParts,
    { hasRow }: { hasRow: boolean },
  ): Omit<Said, "side"> | undefined {
    if (part.type === "reasoning") {
      const words = thoughtText(part.text);
      return words.trim() === ""
        ? undefined
        : {
            body: { text: words, wasSent: true },
            id: part.metadata.id,
            kind: "thought",
            label: "Thought",
            mark: "thought",
          };
    }
    if (part.type === "text") {
      const isReplaced =
        !hasRow &&
        message.role === "assistant" &&
        message.metadata.error !== undefined &&
        part.text.trim() !== "";
      return isReplaced
        ? {
            body: { text: part.text, wasSent: false },
            id: part.metadata.id,
            kind: "replaced",
            label: named("Replaced", part.text),
            mark: "replaced",
          }
        : undefined;
    }
    if (!isDataPart(part) || NEVER_NOTES.has(part.type)) {
      return undefined;
    }
    if (part.type === "data-requestFailure") {
      return {
        body: { detail: part.data.error, wasSent: false },
        id: part.metadata.id,
        kind: "error",
        label: labelOf(part),
        mark: MARK_OF_PART[part.type],
      };
    }
    if (part.type === "data-requestNote") {
      return {
        body: { text: part.data.text, wasSent: true },
        id: part.metadata.id,
        kind: "note",
        label: labelOf(part),
        mark: MARK_OF_PART[part.type],
      };
    }
    const note = heard.get(part.metadata.id);
    if (note) {
      return {
        body: { text: note.text, wasSent: true },
        id: part.metadata.id,
        kind: "note",
        label: labelOf(part),
        mark: MARK_OF_PART[part.type],
      };
    }
    // A picture that says what the last one said told the model nothing, and
    // a part hidden from everyone that told it nothing has nothing to say.
    if (STATE_PARTS.has(part.type) || dataPartVisibility(part) === "hidden") {
      return undefined;
    }
    return {
      body: { detail: JSON.stringify(part.data, null, 2), wasSent: false },
      id: part.metadata.id,
      kind: "note",
      label: labelOf(part),
      mark: MARK_OF_PART[part.type],
    };
  }
}

/** The notes a session's records come to; see {@link developerNotesWithBodies}. */
export function developerNotes(
  messages: readonly SessionMessage.WithParts[],
  options: NoteOptions,
): DeveloperNote[] {
  return developerNotesWithBodies(messages, options).notes;
}
