import { describe, expect, it } from "vitest";

import {
  type Destination,
  destinationStep,
  refusalToast,
  suggestedDestination,
} from "./instrument-folder-steps";

const at = (
  contents: Destination["contents"],
  verdict: Destination["verdict"],
): Destination => ({ contents, path: "/Users/sam/Notes/Instrument", verdict });

describe("destinationStep", () => {
  it.each<[string, Destination, boolean, unknown]>([
    [
      "makes a folder that isn't there yet",
      at("new", { kind: "movable" }),
      false,
      { create: true, type: "move" },
    ],
    [
      "moves into one that is",
      at("files", { kind: "movable" }),
      false,
      { create: false, type: "move" },
    ],
    [
      "opens an Instrument folder where the screen opens one",
      at("files", { kind: "workspace", name: "Lab" }),
      true,
      { type: "open" },
    ],
    [
      "won't move into an Instrument folder anywhere else",
      at("files", { kind: "workspace", name: "Lab" }),
      false,
      { type: "other-workspace" },
    ],
    [
      "passes a refusal on",
      at("empty", { kind: "refused", reason: "unwritable" }),
      true,
      { reason: "unwritable", type: "refused" },
    ],
  ])("%s", (_name, destination, opens, step) => {
    expect(destinationStep(destination, { opens })).toEqual(step);
  });
});

describe("refusalToast", () => {
  it("says where the folder already is as news, not an error", () => {
    expect(
      refusalToast("current", {
        current: "/Users/sam/Documents/Instrument",
        path: "/Users/sam/Documents/Instrument",
      }),
    ).toEqual({
      description: "It’s in “Documents”.",
      title: "Your Instrument folder is already there",
      tone: "info",
    });
  });

  it("names the folder picked for one inside or around the Instrument folder", () => {
    expect(
      refusalToast("inside", {
        current: "/Users/sam/Instrument",
        path: "/Users/sam/Instrument/Work",
      }).description,
    ).toBe("“Work” is inside it.");
    expect(
      refusalToast("around", { current: "/Users/sam/Instrument", path: "/" })
        .tone,
    ).toBe("error");
  });
});

describe("suggestedDestination", () => {
  it("reads a suggested folder that isn't there yet as the new folder to make", () => {
    expect(
      suggestedDestination(at("empty", { kind: "refused", reason: "missing" })),
    ).toEqual(at("new", { kind: "movable" }));
  });

  it("keeps anything else as it was checked", () => {
    const denied = at("empty", { kind: "refused", reason: "unwritable" });
    expect(suggestedDestination(denied)).toBe(denied);
  });
});
