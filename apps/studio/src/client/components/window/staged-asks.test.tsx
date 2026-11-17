import { draftsAtom, resetDrafts } from "@/client/drafts/store";
import { createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";

import {
  type AskDestination,
  type StagedAsk,
  stagedAsksAtom,
} from "./staged-asks";

afterEach(() => {
  resetDrafts();
});

const ask = (id: string, createdAt: number): StagedAsk => ({
  createdAt,
  id,
  instruction: "",
  path: "/Users/mac-user/notes.md",
  target: `line ${createdAt.toString()}`,
});

/** A window with one new chat's draft, listening to main as a mounted one does. */
function window() {
  resetDrafts([{ createdAt: 1, id: "d1", updatedAt: 1, words: "" }]);
  const store = createStore();
  store.sub(draftsAtom, () => undefined);
  store.set(stagedAsksAtom, [ask("a", 1), ask("b", 2)]);
  const draftAsks = () =>
    store.get(draftsAtom).find((draft) => draft.id === "d1")?.asks;
  const move = (ids: string[], destination: AskDestination) => {
    store.set(stagedAsksAtom, (current) =>
      current.map((each) =>
        ids.includes(each.id) ? { ...each, destination } : each,
      ),
    );
  };
  return { draftAsks, move, store };
}

describe("asks moved into a new chat's draft", () => {
  it("are kept with the draft, and still listed in their order", () => {
    const { draftAsks, move, store } = window();
    move(["a"], { draftId: "d1", kind: "draft" });

    expect(draftAsks()).toEqual([ask("a", 1)]);
    expect(store.get(stagedAsksAtom)).toEqual([
      { ...ask("a", 1), destination: { draftId: "d1", kind: "draft" } },
      ask("b", 2),
    ]);
  });

  it("come back with the draft in a window that never held them", () => {
    // Main's drafts as a relaunch reads them.
    resetDrafts([
      {
        asks: [ask("a", 1), ask("b", 2)],
        createdAt: 1,
        id: "d1",
        updatedAt: 1,
        words: "",
      },
    ]);
    const other = createStore();
    other.sub(draftsAtom, () => undefined);
    expect(other.get(stagedAsksAtom).map((each) => each.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("leave the draft as they go back to their file or are sent", () => {
    const { draftAsks, store } = window();
    store.set(stagedAsksAtom, (current) =>
      current.map((each) => ({
        ...each,
        destination: { draftId: "d1", kind: "draft" as const },
      })),
    );
    store.set(stagedAsksAtom, (current) =>
      current.flatMap((each) => {
        if (each.id === "b") {
          return [];
        }
        const { destination: _moved, ...waiting } = each;
        return [waiting];
      }),
    );

    expect(draftAsks()).toBeUndefined();
    expect(store.get(stagedAsksAtom)).toEqual([ask("a", 1)]);
  });
});
