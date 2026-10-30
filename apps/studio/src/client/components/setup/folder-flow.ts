import { type Destination } from "@/client/components/instrument-folder-steps";

/**
 * Where the folder step stands, as a reducer the page drives, so each way
 * through is checked without a folder picker or a restart.
 *
 * `page` is what is on screen: Welcome on a first launch, the folder (or,
 * while a lost folder is unanswered, the page saying why it couldn't be
 * opened), or the page shown while Continue makes, moves or opens it. What
 * the person chose stays across all three, so going back to Welcome, or a
 * move that fails, comes back to the folder as it was left.
 */
export type FolderFlowState = {
  /** A note under the folder, for what Continue ran into. */
  note: FolderNoteKind | null;
  page:
    | { how: "move" | "open"; kind: "moving" }
    | { kind: "choose" }
    | { kind: "welcome" };
  /** The folder picked, or put on screen in place of the suggested one. */
  picked: Destination | null;
  /**
   * Past the page saying why a lost folder couldn't be opened: picking where
   * it is now or another folder, or starting over in a new one. Only ever set
   * for a lost folder.
   */
  lostPast: "found" | "new" | null;
  /** The lost folder's page opened it once already, so showing it again waits for Continue. */
  triedOpen: boolean;
};

type FolderNoteKind = "denied" | "unfinished";

export type FolderFlowEvent =
  /** The folder Continue looked at was refused, and another put in its place. */
  | { note: FolderNoteKind | null; picked: Destination; type: "fellBack" }
  /** The person picked a folder; `lost` when the launch couldn't open the workspace's own. */
  | { destination: Destination; lost: boolean; type: "picked" }
  /** Continue looked at the suggested folder and shows it, for the next Continue to go on. */
  | { destination: Destination; type: "suggestionSeen" }
  | { how: "move" | "open"; type: "moving" }
  | { note: FolderNoteKind; type: "noted" }
  /** Back from a lost folder's pick, to the page saying why it was lost. */
  | { type: "backToLost" }
  | { type: "backToWelcome" }
  /** Continue's move or open ended without the app going on. */
  | { type: "moveEnded" }
  | { type: "openedLost" }
  | { type: "start" }
  | { type: "startOver" };

export function initialFolderFlow(isFirst: boolean): FolderFlowState {
  return {
    lostPast: null,
    note: null,
    page: { kind: isFirst ? "welcome" : "choose" },
    picked: null,
    triedOpen: false,
  };
}

export function folderFlowStep(
  state: FolderFlowState,
  event: FolderFlowEvent,
): FolderFlowState {
  switch (event.type) {
    case "backToLost": {
      return { ...state, lostPast: null, note: null, picked: null };
    }
    case "backToWelcome": {
      return { ...state, page: { kind: "welcome" } };
    }
    case "fellBack": {
      return { ...state, note: event.note, picked: event.picked };
    }
    case "moveEnded": {
      return state.page.kind === "moving"
        ? { ...state, page: { kind: "choose" } }
        : state;
    }
    case "moving": {
      return { ...state, page: { how: event.how, kind: "moving" } };
    }
    case "noted": {
      return { ...state, note: event.note };
    }
    case "openedLost": {
      return { ...state, triedOpen: true };
    }
    case "picked": {
      return {
        ...state,
        lostPast: state.lostPast ?? (event.lost ? "found" : null),
        note: null,
        picked: event.destination,
      };
    }
    case "start": {
      return { ...state, page: { kind: "choose" } };
    }
    case "startOver": {
      return { ...state, lostPast: "new" };
    }
    case "suggestionSeen": {
      return { ...state, picked: event.destination };
    }
  }
}
