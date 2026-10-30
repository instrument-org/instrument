import { type Destination } from "@/client/components/instrument-folder-steps";
import { describe, expect, it } from "vitest";

import {
  type FolderFlowEvent,
  type FolderFlowState,
  folderFlowStep,
  initialFolderFlow,
} from "./folder-flow";

const run = (from: FolderFlowState, ...events: FolderFlowEvent[]) =>
  events.reduce(folderFlowStep, from);

const folder = (path: string): Destination => ({
  contents: "new",
  path,
  verdict: { kind: "movable" },
});
const documents = folder("/Users/mac-user/Documents/Instrument");
const home = folder("/Users/mac-user/Instrument");

describe("folderFlowStep", () => {
  it("opens a first launch on Welcome, and keeps a pick across Back", () => {
    const state = run(
      initialFolderFlow(true),
      { type: "start" },
      { destination: documents, lost: false, type: "picked" },
      { type: "backToWelcome" },
    );
    expect(state.page).toEqual({ kind: "welcome" });
    expect(run(state, { type: "start" }).picked).toBe(documents);
  });

  it("opens straight on the folder for a workspace already running", () => {
    expect(initialFolderFlow(false).page).toEqual({ kind: "choose" });
  });

  it("marks a pick as past a lost folder only when the folder was lost", () => {
    expect(
      run(initialFolderFlow(false), {
        destination: documents,
        lost: false,
        type: "picked",
      }).lostPast,
    ).toBeNull();
    expect(
      run(initialFolderFlow(false), {
        destination: documents,
        lost: true,
        type: "picked",
      }).lostPast,
    ).toBe("found");
  });

  it("keeps starting over through a pick, and Back returns to the lost page clean", () => {
    const started = run(
      initialFolderFlow(false),
      { type: "openedLost" },
      { type: "startOver" },
      { destination: documents, lost: true, type: "picked" },
    );
    expect(started).toMatchObject({ lostPast: "new", triedOpen: true });
    expect(run(started, { type: "backToLost" })).toEqual({
      lostPast: null,
      note: null,
      page: { kind: "choose" },
      picked: null,
      triedOpen: true,
    });
  });

  it("comes back to the folder as it was left when a move ends", () => {
    const moving = run(
      initialFolderFlow(false),
      { destination: documents, lost: false, type: "picked" },
      { how: "move", type: "moving" },
    );
    expect(moving.page).toEqual({ how: "move", kind: "moving" });
    const back = run(moving, { type: "moveEnded" });
    expect(back.page).toEqual({ kind: "choose" });
    expect(back.picked).toBe(documents);
  });

  it("leaves Welcome alone when a move ends there", () => {
    const welcome = initialFolderFlow(true);
    expect(run(welcome, { type: "moveEnded" })).toBe(welcome);
  });

  it("falls back to the home folder with a note, which the next pick clears", () => {
    const fellBack = run(
      initialFolderFlow(false),
      { how: "move", type: "moving" },
      { type: "moveEnded" },
      { note: "denied", picked: home, type: "fellBack" },
    );
    expect(fellBack).toMatchObject({ lostPast: null, note: "denied" });
    expect(fellBack.picked).toBe(home);
    expect(
      run(fellBack, { destination: documents, lost: false, type: "picked" })
        .note,
    ).toBeNull();
  });

  it("shows the suggested folder without touching the note or a lost folder's answer", () => {
    const state = run(
      initialFolderFlow(false),
      { note: "unfinished", type: "noted" },
      { destination: documents, type: "suggestionSeen" },
    );
    expect(state).toMatchObject({ lostPast: null, note: "unfinished" });
    expect(state.picked).toBe(documents);
  });
});
