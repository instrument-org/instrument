import { describe, expect, it } from "vitest";

import { count, folderAction, foundNote, them } from "./folder-flow";

const empty = { chats: 0, items: 0 };

describe("folderAction", () => {
  it("makes a folder that isn't there yet, which is when macOS asks", () => {
    expect(
      folderAction({
        seen: null,
        summary: null,
        verdict: { kind: "refused", reason: "missing" },
      }),
    ).toEqual({ create: true, type: "move" });
  });

  it("reads a refusal to look inside as Documents denied", () => {
    expect(
      folderAction({
        seen: null,
        summary: null,
        verdict: { kind: "refused", reason: "unwritable" },
      }),
    ).toEqual({ type: "denied" });
  });

  it("says what a folder has before moving in beside it", () => {
    const verdict = { kind: "movable" } as const;
    const summary = { chats: 0, items: 214 };
    expect(folderAction({ seen: null, summary, verdict })).toEqual({
      items: 214,
      type: "exists",
    });
    expect(folderAction({ seen: "exists", summary, verdict })).toEqual({
      create: false,
      type: "move",
    });
    expect(folderAction({ seen: null, summary: empty, verdict })).toEqual({
      create: false,
      type: "move",
    });
  });

  it("opens an earlier Instrument folder once its chats were named", () => {
    const verdict = { kind: "workspace", name: "Instrument" } as const;
    const summary = { chats: 12, items: 3 };
    expect(folderAction({ seen: null, summary, verdict })).toEqual({
      chats: 12,
      type: "earlier",
    });
    expect(folderAction({ seen: "earlier", summary, verdict })).toEqual({
      type: "open",
    });
  });

  it("offers to leave a folder an earlier build is still updating where it is", () => {
    expect(
      folderAction({
        seen: null,
        summary: null,
        verdict: { kind: "refused", reason: "unfinished" },
      }),
    ).toEqual({ type: "unfinished" });
  });

  it("passes on any other refusal with its reason", () => {
    expect(
      folderAction({
        seen: null,
        summary: null,
        verdict: { kind: "refused", reason: "taken" },
      }),
    ).toEqual({ reason: "taken", type: "refused" });
  });

  it("counts in words", () => {
    expect([count(1, "chat"), count(12, "chat")]).toEqual([
      "1 chat",
      "12 chats",
    ]);
  });

  it("says it for one thing and them for more", () => {
    expect([them(1), them(2)]).toEqual(["it", "them"]);
  });
});

describe("foundNote", () => {
  it.each([
    [{ chats: 128, type: "earlier" } as const, { chats: 128, kind: "earlier" }],
    [
      { items: 214, type: "exists" } as const,
      { items: 214, kind: "exists", moving: 3 },
    ],
    [{ create: true, type: "move" } as const, null],
    [{ type: "denied" } as const, null],
  ])("says %o on sight as %o", (action, note) => {
    expect(foundNote(action, 3)).toEqual(note);
  });
});
