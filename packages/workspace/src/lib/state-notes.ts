import { SessionMessageDataPart } from "../schemas/session/message-data-part";
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
  note: (data: DataParts[K]) => string;
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
    note: viewContextModelNote,
  },
  workspaceInstructions: {
    isEmpty: (data) => !data.instructions,
    note: workspaceInstructionsModelNote,
  },
};

/**
 * What a session's `state` parts tell the model, read oldest first. A writer
 * stores the whole picture on every message it can read it for, an empty one
 * included; this is the one place that decides what of it is said: nothing
 * when it reads as the last note said, and nothing for an empty picture
 * before anything was said. A message without the part says nothing, so a
 * picture that could not be read is never mistaken for an empty one.
 *
 * Request assembly and the transcript's developer cards read through the
 * same sequence, so a card shows exactly the note the model got.
 */
export function stateNotes(): (
  part: SessionMessagePart.DataPart,
) => string | undefined {
  const lastSaid = new Map<StateName, string>();
  const tell = <K extends StateName>(name: K, data: DataParts[K]) => {
    const { isEmpty, note } = STATE_NOTES[name];
    if (!lastSaid.has(name) && isEmpty(data)) {
      return undefined;
    }
    const text = note(data);
    if (lastSaid.get(name) === text) {
      return undefined;
    }
    lastSaid.set(name, text);
    return text;
  };
  return (part) => {
    switch (part.type) {
      case "data-browserStatus": {
        return tell("browserStatus", part.data);
      }
      case "data-topic": {
        return tell("topic", part.data);
      }
      case "data-viewContext": {
        return tell("viewContext", part.data);
      }
      case "data-workspaceInstructions": {
        return tell("workspaceInstructions", part.data);
      }
      default: {
        part.type satisfies Exclude<
          SessionMessagePart.DataPart["type"],
          `data-${StateName}`
        >;
        return undefined;
      }
    }
  };
}
