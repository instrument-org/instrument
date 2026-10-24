import { SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { browserStatusModelNote } from "./browser-status-model-text";
import { topicModelNote } from "./topic-model-text";
import { viewContextModelNote } from "./view-context-model-text";
import { workspaceInstructionsModelNote } from "./workspace-instructions-model-text";

type DataParts = SessionMessageDataPart.DataParts;

/** The parts `CADENCE` calls `state`. */
type StateName = {
  [K in SessionMessageDataPart.Name]: (typeof SessionMessageDataPart.CADENCE)[K] extends "state"
    ? K
    : never;
}[SessionMessageDataPart.Name];

type StateNote<K extends StateName> = {
  /** A picture with nothing in it, which is news only after one that had something. */
  isEmpty: (data: DataParts[K]) => boolean;
  note: (data: DataParts[K], options: StateNoteOptions) => string;
};

type StateNoteOptions = {
  /**
   * How the agent's shell spells a host path; the host spelling when absent.
   * Passed in because this module is shared with the renderer, which has no
   * `process` and must not load the shell's filesystem layout.
   */
  shellPath?: (hostPath: string) => string;
};

/** A part declared `state` without an entry here does not compile. */
const STATE_NOTES: { [K in StateName]: StateNote<K> } = {
  browserStatus: {
    isEmpty: (data) => data.status === "tabs" && data.tabs.length === 0,
    note: browserStatusModelNote,
  },
  topic: {
    isEmpty: (data) => data.topic === null,
    note: topicModelNote,
  },
  viewContext: {
    isEmpty: () => false,
    note: (data, { shellPath }) => viewContextModelNote(data, shellPath),
  },
  workspaceInstructions: {
    isEmpty: (data) => !data.instructions,
    note: workspaceInstructionsModelNote,
  },
};

/**
 * What a session's `state` parts tell the model, read oldest first. A writer
 * stores the whole picture on every message it can read it for, an empty one
 * included once the session has had something in it (`goesUnsaid`); this is
 * the one place that decides what of it is said: nothing when it reads as the
 * last note said, and nothing for an empty picture before anything was said.
 * A message without the part says nothing, so a picture that could not be
 * read is never mistaken for an empty one.
 *
 * Request assembly and the transcript's developer cards read through the
 * same sequence, so a card shows exactly the note the model got.
 */
export function stateNotes(
  options: StateNoteOptions = {},
): (part: SessionMessagePart.DataPart) => string | undefined {
  const lastSaid = new Map<StateName, string>();
  return (part) => {
    const state = stateOf(part);
    if (state === undefined) {
      return undefined;
    }
    if (!lastSaid.has(state.name) && state.isEmpty()) {
      return undefined;
    }
    const text = state.note(options);
    if (lastSaid.get(state.name) === text) {
      return undefined;
    }
    lastSaid.set(state.name, text);
    return text;
  };
}

/**
 * Whether a writer can leave `part` off its message: an empty picture in a
 * session whose history has never had anything in that picture. Every reader
 * reads a stretch of that history (a rollover's window, a task's inherited
 * start), where nothing was said of the picture before, so the part would say
 * nothing there, as a missing one does.
 */
export function goesUnsaid(
  part: SessionMessagePart.Type,
  history: readonly SessionMessage.WithParts[],
): boolean {
  if (stateOf(part)?.isEmpty() !== true) {
    return false;
  }
  return !history.some((message) =>
    message.parts.some(
      (earlier) =>
        earlier.type === part.type && stateOf(earlier)?.isEmpty() === false,
    ),
  );
}

/** A `state` part read through its `STATE_NOTES` entry; undefined for any other part. */
function stateOf(
  part: SessionMessagePart.Type,
):
  | {
      isEmpty: () => boolean;
      name: StateName;
      note: (options: StateNoteOptions) => string;
    }
  | undefined {
  const entry = <K extends StateName>(name: K, data: DataParts[K]) => ({
    isEmpty: () => STATE_NOTES[name].isEmpty(data),
    name,
    note: (options: StateNoteOptions) => STATE_NOTES[name].note(data, options),
  });
  switch (part.type) {
    case "data-browserStatus": {
      return entry("browserStatus", part.data);
    }
    case "data-topic": {
      return entry("topic", part.data);
    }
    case "data-viewContext": {
      return entry("viewContext", part.data);
    }
    case "data-workspaceInstructions": {
      return entry("workspaceInstructions", part.data);
    }
    default: {
      part.type satisfies Exclude<
        SessionMessagePart.Type["type"],
        `data-${StateName}`
      >;
      return undefined;
    }
  }
}
