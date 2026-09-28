import { type ComposeEntry } from "@/client/atoms/orchestrator";
import { StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  COMPOSE_BAR_WIDTH,
  COMPOSE_EDGE_GAP,
  COMPOSE_GAP,
  COMPOSE_WIDTH,
  layoutCompose,
  THREAD_WINDOW_WIDTH,
} from "./compose-layout";

function draft(
  draftId: string,
  placement: ComposeEntry["placement"] = "docked",
): ComposeEntry {
  return { draftId, kind: "draft", placement };
}

/** What a placed entry stands for, by the id its kind carries. */
function idOf(entry: ComposeEntry) {
  return entry.kind === "draft" ? entry.draftId : entry.sessionId;
}

function thread(
  id: string,
  placement: ComposeEntry["placement"] = "docked",
): ComposeEntry {
  return {
    kind: "thread",
    placement,
    sessionId: StoreId.SessionSchema.parse(id),
  };
}

describe("layoutCompose", () => {
  it("stands the newest draft at the right edge and the older beside it", () => {
    const placed = layoutCompose([draft("a"), draft("b")], 2000);
    expect(placed.map((entry) => [idOf(entry), entry.right])).toEqual([
      ["b", COMPOSE_EDGE_GAP],
      ["a", COMPOSE_EDGE_GAP + COMPOSE_WIDTH + COMPOSE_GAP],
    ]);
  });

  it("leaves out the drafts there is no room for, from the left", () => {
    const placed = layoutCompose(
      [draft("a", "bar"), draft("b"), draft("c")],
      COMPOSE_EDGE_GAP + COMPOSE_WIDTH + COMPOSE_GAP * 2 + COMPOSE_BAR_WIDTH,
    );
    // The bar after the window would have fit; the window before it ends the
    // row, so the drafts stay in their order.
    expect(placed.map(idOf)).toEqual(["c"]);
  });

  it("lays a minimized chat that holds tabs at a bar's width, with no room for a rail", () => {
    const placed = layoutCompose(
      [
        thread("ses_01ARZ3NDEKTSV4RRFFQ69G5FAV", "bar"),
        thread("ses_01ARZ3NDEKTSV4RRFFQ69G5FAW", "bar"),
      ],
      2000,
      () => true,
    );
    expect(placed.map((entry) => entry.right)).toEqual([
      COMPOSE_EDGE_GAP,
      COMPOSE_EDGE_GAP + COMPOSE_BAR_WIDTH + COMPOSE_GAP,
    ]);
  });

  it("lays a bar beside a window at its own width", () => {
    const placed = layoutCompose([draft("a"), draft("b", "bar")], 2000);
    expect(placed.map((entry) => [idOf(entry), entry.right])).toEqual([
      ["b", COMPOSE_EDGE_GAP],
      ["a", COMPOSE_EDGE_GAP + COMPOSE_BAR_WIDTH + COMPOSE_GAP],
    ]);
  });

  it("stands a grown window alone among the windows, with the bars kept", () => {
    const placed = layoutCompose(
      [draft("a"), draft("b", "bar"), draft("c", "expanded")],
      2000,
    );
    expect(placed.map((entry) => [idOf(entry), entry.placement])).toEqual([
      ["c", "expanded"],
      ["b", "bar"],
    ]);
  });

  it("lays a thread's small view at its own width beside a draft's window", () => {
    const placed = layoutCompose(
      [draft("a"), thread("ses_01J8ZZZZZZZZZZZZZZZZZZZZZ1"), draft("b", "bar")],
      2000,
    );
    expect(placed.map((entry) => [idOf(entry), entry.right])).toEqual([
      ["b", COMPOSE_EDGE_GAP],
      [
        "ses_01J8ZZZZZZZZZZZZZZZZZZZZZ1",
        COMPOSE_EDGE_GAP + COMPOSE_BAR_WIDTH + COMPOSE_GAP,
      ],
      [
        "a",
        COMPOSE_EDGE_GAP +
          COMPOSE_BAR_WIDTH +
          COMPOSE_GAP +
          THREAD_WINDOW_WIDTH +
          COMPOSE_GAP,
      ],
    ]);
  });

  it("puts a thread down to a bar of the same width as a draft's", () => {
    const placed = layoutCompose(
      [
        thread("ses_01J8ZZZZZZZZZZZZZZZZZZZZZ2", "bar"),
        thread("ses_01J8ZZZZZZZZZZZZZZZZZZZZZ3", "bar"),
      ],
      2000,
    );
    expect(placed.map((entry) => [idOf(entry), entry.right])).toEqual([
      ["ses_01J8ZZZZZZZZZZZZZZZZZZZZZ3", COMPOSE_EDGE_GAP],
      [
        "ses_01J8ZZZZZZZZZZZZZZZZZZZZZ2",
        COMPOSE_EDGE_GAP + COMPOSE_BAR_WIDTH + COMPOSE_GAP,
      ],
    ]);
  });

  it("keeps the right edge's room the same on screen at any zoom", () => {
    const placed = layoutCompose([draft("a")], 2000, undefined, 2);
    expect(placed.map((entry) => entry.right)).toEqual([COMPOSE_EDGE_GAP / 2]);
  });

  it("draws nothing before the row has a width", () => {
    expect(layoutCompose([draft("a")], 0)).toEqual([]);
  });

  // 1.5x zoom at the window's 900px minimum leaves a row of 524 layout px.
  it("narrows the newest window to a row too small for it, and drops the rest", () => {
    expect(layoutCompose([draft("a"), draft("b")], 524)).toEqual([
      { ...draft("b"), right: 20, width: 492 },
    ]);
  });
});
