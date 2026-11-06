import { sort } from "radashi";

import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type StoreId } from "../../schemas/store-id";
import { dataPartVisibility } from "../data-part-visibility";
import { stateNotes } from "../state-notes";
import {
  isStepPart,
  thoughtText,
  transcriptMessage,
} from "./transcript-message";
import { type TurnRow, turnsOf } from "./turns-of";

/** What a margin note stands for. */
type DeveloperNoteKind = "error" | "note" | "replaced" | "thought";

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

/** Which way a note looks for its row: where it was heard, or what it went out with. */
type Looks = "back" | "forward";

type Waiting = Pick<DeveloperNote, "id" | "kind" | "label" | "side"> & {
  looks: Looks;
};

type Place = Pick<DeveloperNote, "row" | "rowKind" | "rowLabel">;

type Seen = { at?: Place; note: Waiting } | { row: Place };

/** Parts the app reads to draw a row, which say nothing of their own. */
const NEVER_NOTES = new Set<SessionMessagePart.DataPart["type"]>([
  "data-ratingCard",
  "data-stepFacts",
  "data-workSummary",
]);

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

function errorLabel(
  error: NonNullable<SessionMessage.Assistant["metadata"]["error"]>,
): string {
  return error.kind === "aborted" ? "Stopped" : `Error: ${error.kind}`;
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
 * sits level with: what the person's message carried beside the message, and
 * what the agent's work carried beside the row it went out with. Everything
 * here is left out of the rows, so what a developer reads costs nothing in
 * what everyone reads.
 *
 * The same records always give the same notes, and a whole session gives them
 * however few of its turns are on screen.
 */
export function developerNotes(
  messages: readonly SessionMessage.WithParts[],
  { sessionId }: { sessionId: StoreId.Session },
): DeveloperNote[] {
  const stored = messages.filter(
    (message) => message.role === "assistant" || message.role === "user",
  );
  const light = stored.flatMap((message) => transcriptMessage(message) ?? []);
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
  const stateNote = stateNotes();
  const notes: DeveloperNote[] = [];
  // Notes with no row to sit by in their own turn wait for the next one's.
  let carried: Waiting[] = [];

  for (const [at, turn] of turns.entries()) {
    const next = turns[at + 1];
    const body = stored.slice(
      startOf.get(turn.id) ?? 0,
      next ? startOf.get(next.id) : undefined,
    );
    const rowOfPart = rowsByPart(turn.rows, startedTask);
    const opensWith: Place | undefined = turn.opener && {
      row: `message:${turn.id}`,
      rowKind: "bubble",
      rowLabel: firstWords(
        turn.opener.text?.text ?? turn.opener.fromChat?.text ?? "Message",
      ),
    };
    const seen: Seen[] = carried.map((note) => ({ note }));
    carried = [];
    const inThisTurn: DeveloperNote[] = [];

    const place = (note: Waiting, where: Place) => {
      inThisTurn.push({
        ...(turn.foldedRowIds.has(where.row) && { foldedIn: turn.id }),
        id: note.id,
        kind: note.kind,
        label: note.label,
        row: where.row,
        rowKind: where.rowKind,
        rowLabel: where.rowLabel,
        side: note.side,
        turn: turn.id,
      });
    };

    for (const each of body) {
      const opens = opensWith !== undefined && each.id === turn.id;
      for (const part of each.parts) {
        const own = rowOfPart.get(part.metadata.id);
        if (own) {
          seen.push({ row: own });
        }
        const said = noteOfPart(part, each, { hasRow: own !== undefined });
        if (!said) {
          continue;
        }
        const side = each.role === "user" ? "right" : "left";
        const waiting = { ...said, side } as const;
        seen.push({
          at: opens ? opensWith : own,
          note: waiting,
        });
        if (isDataPart(part) && !said.isStateNote) {
          stateNote(part);
        }
      }
      const error = each.role === "assistant" ? each.metadata.error : undefined;
      if (error && each.role === "assistant") {
        const row = turn.rows.find(
          (candidate) =>
            candidate.kind === "error" && candidate.message.id === each.id,
        );
        if (row) {
          seen.push({ row: rowOfError(row) });
        } else {
          seen.push({
            note: {
              id: `error-${each.id}`,
              kind: "error",
              label: errorLabel(error),
              looks: "forward",
              side: "left",
            },
          });
        }
      }
    }

    for (const [index, item] of seen.entries()) {
      if (!("note" in item)) {
        continue;
      }
      if (item.at) {
        place(item.note, item.at);
        continue;
      }
      const rowAfter = seen.slice(index + 1).find((one) => "row" in one);
      const rowBefore = seen.slice(0, index).findLast((one) => "row" in one);
      const [first, second] =
        item.note.looks === "forward"
          ? [rowAfter, rowBefore]
          : [rowBefore, rowAfter];
      const found = first ?? second;
      if (found && "row" in found) {
        place(item.note, found.row);
      } else if (opensWith) {
        place(item.note, opensWith);
      } else {
        carried.push(item.note);
      }
    }
    // In the order they draw, and on one row in the order they happened.
    const rowIndex = (note: DeveloperNote) =>
      turn.rows.findIndex((row) => row.id === note.row);
    notes.push(...sort(inThisTurn, rowIndex));
  }
  return notes;

  /** What a stored part says beside the transcript, or nothing. */
  function noteOfPart(
    part: SessionMessagePart.Type,
    message: SessionMessage.WithParts,
    { hasRow }: { hasRow: boolean },
  ): (Omit<Waiting, "side"> & { isStateNote?: boolean }) | undefined {
    if (part.type === "reasoning") {
      const words = firstWords(thoughtText(part.text));
      return words === ""
        ? undefined
        : {
            id: part.metadata.id,
            kind: "thought",
            label: `Thought: ${words}`,
            looks: "forward",
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
            id: part.metadata.id,
            kind: "replaced",
            label: `Replaced: ${firstWords(part.text)}`,
            looks: "forward",
          }
        : undefined;
    }
    if (
      !isDataPart(part) ||
      NEVER_NOTES.has(part.type) ||
      dataPartVisibility(part) === "hidden"
    ) {
      return undefined;
    }
    // A picture that says what the last one said told the model nothing.
    const isState =
      part.type === "data-browserStatus" ||
      part.type === "data-project" ||
      part.type === "data-viewContext" ||
      part.type === "data-workspaceInstructions";
    if (isState && stateNote(part) === undefined) {
      return undefined;
    }
    return {
      id: part.metadata.id,
      isStateNote: isState,
      kind: "note",
      label: noteName(part.type),
      looks: message.role === "user" ? "forward" : "back",
    };
  }
}
