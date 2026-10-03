import { describe, expect, it } from "vitest";

import {
  RENAME_IDLE,
  type RenameEffect,
  type RenameEvent,
  type RenameState,
  renameStep,
} from "./file-system-rename";

/** Every effect the events produce in turn, and where they leave the machine. */
function run(events: RenameEvent[], from: RenameState = RENAME_IDLE) {
  let state = from;
  const effects: RenameEffect[] = [];
  for (const event of events) {
    const next = renameStep(state, event);
    effects.push(...next.effects);
    state = next.state;
  }
  return { effects, state };
}

const START: RenameEvent = {
  name: "notes.txt",
  path: "notes.txt",
  type: "start",
};

function listed(...names: string[]): RenameEvent {
  return {
    nameOf: (path) => (names.includes(path) ? path : null),
    type: "listed",
  };
}

describe("renaming in place", () => {
  it("saves a new name once, however many ways it is accepted", () => {
    const { effects, state } = run([
      START,
      { text: "plans.txt", type: "accept" },
      // The field losing the keyboard as Return puts it away.
      { text: "plans.txt", type: "accept" },
      { text: "plans.txt", type: "accept" },
    ]);
    expect(effects).toEqual([
      { name: "plans.txt", path: "notes.txt", type: "save" },
    ]);
    expect(state.phase).toBe("saving");
    expect(run([{ type: "saved" }], state)).toEqual({
      effects: [{ type: "ended" }],
      state: RENAME_IDLE,
    });
  });

  it.each([
    ["an unchanged name", "notes.txt"],
    ["an empty name", "   "],
    ["the same name with spaces around it", "  notes.txt "],
  ])("saves nothing for %s", (_, text) => {
    expect(run([START, { text, type: "accept" }])).toEqual({
      effects: [{ type: "ended" }],
      state: RENAME_IDLE,
    });
  });

  it("saves the name trimmed", () => {
    expect(
      run([START, { text: " plans.txt ", type: "accept" }]).effects,
    ).toEqual([{ name: "plans.txt", path: "notes.txt", type: "save" }]);
  });

  it("puts away the field on Escape, and a late accept does nothing", () => {
    expect(
      run([START, { type: "cancel" }, { text: "plans.txt", type: "accept" }]),
    ).toEqual({ effects: [{ type: "ended" }], state: RENAME_IDLE });
  });

  it("opens the field again with what was typed when the save fails", () => {
    const { effects, state } = run([
      START,
      { text: "plans.txt", type: "accept" },
      { type: "save-failed" },
    ]);
    expect(effects).toHaveLength(1);
    expect(state).toEqual({
      attempt: 1,
      draft: "plans.txt",
      name: "notes.txt",
      path: "notes.txt",
      phase: "editing",
    });
    // And accepting it again saves again.
    expect(
      run([{ text: "plans 2.txt", type: "accept" }], state).effects,
    ).toEqual([{ name: "plans 2.txt", path: "notes.txt", type: "save" }]);
  });

  it("does not start a second rename while one is saving", () => {
    const saving = run([START, { text: "plans.txt", type: "accept" }]).state;
    expect(run([{ name: "b", path: "b", type: "start" }], saving).state).toBe(
      saving,
    );
  });

  it("ends when the row goes out from under the field", () => {
    expect(run([START, listed("other.txt")])).toEqual({
      effects: [{ type: "ended" }],
      state: RENAME_IDLE,
    });
  });

  it("keeps saving when the old row goes as the new name lands", () => {
    const saving = run([START, { text: "plans.txt", type: "accept" }]).state;
    expect(run([listed("plans.txt")], saving).state).toBe(saving);
  });
});

describe("renaming what is not listed yet", () => {
  const NEW_FOLDER: RenameEvent = {
    name: null,
    path: "untitled folder/",
    type: "start",
  };

  it("opens the field once the row is listed", () => {
    const { state } = run([
      NEW_FOLDER,
      listed("notes.txt"),
      listed("notes.txt", "untitled folder/"),
    ]);
    expect(state).toMatchObject({
      draft: "untitled folder/",
      path: "untitled folder/",
      phase: "editing",
    });
  });

  it.each<[string, RenameEvent]>([
    ["anything the person does first", { type: "interrupt" }],
    ["Escape", { type: "cancel" }],
  ])("is called off by %s", (_, event) => {
    expect(run([NEW_FOLDER, event, listed("untitled folder/")]).state).toBe(
      RENAME_IDLE,
    );
  });

  it("is not called off by a press once the field is open", () => {
    const { state } = run([
      NEW_FOLDER,
      listed("untitled folder/"),
      { type: "interrupt" },
    ]);
    expect(state.phase).toBe("editing");
  });
});
