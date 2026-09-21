import { describe, expect, it } from "vitest";

import {
  COMPOSE_BAR_WIDTH,
  COMPOSE_GAP,
  COMPOSE_WIDTH,
  layoutCompose,
} from "./compose-layout";

describe("layoutCompose", () => {
  it("stands the newest draft at the right edge and the older beside it", () => {
    const placed = layoutCompose(
      [
        { draftId: "a", placement: "docked" },
        { draftId: "b", placement: "docked" },
      ],
      2000,
    );
    expect(placed.map((entry) => [entry.draftId, entry.right])).toEqual([
      ["b", COMPOSE_GAP],
      ["a", COMPOSE_GAP + COMPOSE_WIDTH + COMPOSE_GAP],
    ]);
  });

  it("leaves out the drafts there is no room for, from the left", () => {
    const placed = layoutCompose(
      [
        { draftId: "a", placement: "bar" },
        { draftId: "b", placement: "docked" },
        { draftId: "c", placement: "docked" },
      ],
      COMPOSE_WIDTH + COMPOSE_GAP * 2 + COMPOSE_BAR_WIDTH,
    );
    // The bar after the window would have fit; the window before it ends the
    // row, so the drafts stay in their order.
    expect(placed.map((entry) => entry.draftId)).toEqual(["c"]);
  });

  it("lays a bar beside a window at its own width", () => {
    const placed = layoutCompose(
      [
        { draftId: "a", placement: "docked" },
        { draftId: "b", placement: "bar" },
      ],
      2000,
    );
    expect(placed.map((entry) => [entry.draftId, entry.right])).toEqual([
      ["b", COMPOSE_GAP],
      ["a", COMPOSE_GAP + COMPOSE_BAR_WIDTH + COMPOSE_GAP],
    ]);
  });

  it("stands a grown window alone among the windows, with the bars kept", () => {
    const placed = layoutCompose(
      [
        { draftId: "a", placement: "docked" },
        { draftId: "b", placement: "bar" },
        { draftId: "c", placement: "expanded" },
      ],
      2000,
    );
    expect(placed.map((entry) => [entry.draftId, entry.placement])).toEqual([
      ["c", "expanded"],
      ["b", "bar"],
    ]);
  });

  it("draws nothing before the row has a width", () => {
    expect(layoutCompose([{ draftId: "a", placement: "docked" }], 0)).toEqual(
      [],
    );
  });
});
