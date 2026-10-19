import { describe, expect, it } from "vitest";

import {
  type DraftFile,
  isDraftFileName,
  isEmptyDraft,
  parseDraftFile,
  renderDraftFile,
} from "./draft-file";

const AT = new Date("2026-10-14T18:22:04.000Z");

function draft(more: Partial<DraftFile> = {}): DraftFile {
  return {
    created: AT,
    id: "01KFDRAFT0000000000000001",
    updated: AT,
    words: "Find a quiet dishwasher.",
    ...more,
  };
}

/** What a render of a draft reads back as, which is what a file holds. */
function roundTrip(written: DraftFile): DraftFile | undefined {
  return parseDraftFile(renderDraftFile(written), { at: written.updated });
}

describe("a draft's file", () => {
  it("reads as the front matter over the words", () => {
    expect(renderDraftFile(draft())).toMatchInlineSnapshot(`
      "---
      id: "01KFDRAFT0000000000000001"
      created: 2026-10-14T18:22:04.000Z
      updated: 2026-10-14T18:22:04.000Z
      ---

      Find a quiet dishwasher.
      "
    `);
  });

  it("keeps front matter it does not know, so another writer's key survives", () => {
    const written = parseDraftFile(
      [
        "---",
        'id: "01KFDRAFT0000000000000001"',
        "created: 2026-10-14T18:22:04.000Z",
        "voice: true",
        "reminder:",
        "  at: 2026-10-15T09:00:00.000Z",
        "  every: weekday",
        "---",
        "",
        "Find a quiet dishwasher.",
        "",
      ].join("\n"),
      { at: AT },
    );
    expect(written?.others).toEqual({
      reminder: { at: "2026-10-15T09:00:00.000Z", every: "weekday" },
      voice: true,
    });
    // Back out whole, after the keys this build writes, with the nesting
    // the other writer gave it.
    expect(renderDraftFile({ ...draft(), others: written?.others })).toContain(
      ["reminder:", "  at: 2026-10-15T09:00:00.000Z", "  every: weekday"].join(
        "\n",
      ),
    );
    expect(roundTrip({ ...draft(), others: written?.others })?.others).toEqual(
      written?.others,
    );
  });

  it("names the chat a reply goes into, and the topic a new chat opens under", () => {
    expect(
      renderDraftFile(
        draft({ chat: "2026-10-14-quiet-dishwashers", topic: "tpc_01KF" }),
      ),
    ).toMatchInlineSnapshot(`
      "---
      id: "01KFDRAFT0000000000000001"
      created: 2026-10-14T18:22:04.000Z
      updated: 2026-10-14T18:22:04.000Z
      chat: "2026-10-14-quiet-dishwashers"
      topic: "tpc_01KF"
      ---

      Find a quiet dishwasher.
      "
    `);
  });

  it("writes the keys a device that sends a draft on its own will read", () => {
    const written = draft({ send: "auto", sendOn: "dev_7QF2KX1M" });
    expect(renderDraftFile(written)).toContain("send: auto");
    expect(roundTrip(written)).toMatchObject({
      send: "auto",
      sendOn: "dev_7QF2KX1M",
    });
  });

  it("lists what was attached by its path, and what was pasted by its name", () => {
    const written = draft({
      attached: [
        {
          kind: "file",
          mediaType: "application/pdf",
          name: "quote: final.pdf",
          path: "/Users/someone/Documents/quote: final.pdf",
          size: 182_344,
        },
        { kind: "folder", path: "/Users/someone/Projects" },
        {
          kind: "file",
          mediaType: "image/png",
          name: "pasted-image.png",
          path: "pasted-image.png",
          size: 48_213,
        },
      ],
    });
    expect(renderDraftFile(written)).toMatchInlineSnapshot(`
      "---
      id: "01KFDRAFT0000000000000001"
      created: 2026-10-14T18:22:04.000Z
      updated: 2026-10-14T18:22:04.000Z
      attached:
        - path: "/Users/someone/Documents/quote: final.pdf"
          kind: file
          name: "quote: final.pdf"
          mediaType: "application/pdf"
          size: 182344
        - path: "/Users/someone/Projects"
          kind: folder
        - path: "pasted-image.png"
          kind: file
          name: "pasted-image.png"
          mediaType: "image/png"
          size: 48213
      ---

      Find a quiet dishwasher.
      "
    `);
    expect(roundTrip(written)?.attached).toEqual(written.attached);
  });

  it("keeps what the app knows about the draft besides that", () => {
    const written = draft({ state: { included: { chat: "a-chat" } } });
    expect(roundTrip(written)?.state).toEqual({ included: { chat: "a-chat" } });
  });

  it.each([
    ["words as typed", "Two spaces  and a tab\there."],
    ["blank lines inside", "One.\n\nTwo.\n\n\nThree."],
    ["a trailing newline", "One.\n"],
    ["trailing blank lines", "One.\n\n\n"],
    ["leading whitespace", "  indented"],
    ["a rule of its own", "One.\n\n---\n\nTwo."],
    ["front matter in the body", "---\nid: not-the-draft\n---\n"],
    ["nothing at all", ""],
  ])("keeps %s byte for byte", (_what, words) => {
    expect(roundTrip(draft({ words }))?.words).toBe(words);
  });

  it("reads words written with carriage returns as lines", () => {
    const text = renderDraftFile(draft({ words: "One.\nTwo." })).replaceAll(
      "\n",
      "\r\n",
    );
    expect(parseDraftFile(text, { at: AT })?.words).toBe("One.\nTwo.");
  });

  it("is no draft without front matter naming an id", () => {
    expect(parseDraftFile("Just some words.\n", { at: AT })).toBeUndefined();
    expect(
      parseDraftFile("---\ntopic: tpc_01KF\n---\n\nWords.\n", { at: AT }),
    ).toBeUndefined();
    expect(parseDraftFile("---\nid: [1, 2\n---\n", { at: AT })).toBeUndefined();
  });

  it("dates a draft by its file where the front matter says nothing", () => {
    const read = parseDraftFile('---\nid: "d1"\n---\n\nWords.\n', { at: AT });
    expect(read).toMatchObject({ created: AT, updated: AT });
  });

  it("keeps the stamps it was written with, whenever the file was written", () => {
    const later = new Date(AT.getTime() + 60_000);
    // A read that moved the stamp to the file's own moment would hand the
    // app something it never wrote, and writing that back would move it
    // again, on and on.
    expect(
      parseDraftFile(renderDraftFile(draft()), { at: later }),
    ).toMatchObject({ created: AT, updated: AT });
  });

  it("holds nothing when it has no words and nothing was put in it", () => {
    expect(isEmptyDraft(draft({ words: "   \n" }))).toBe(true);
    expect(
      isEmptyDraft(
        draft({
          attached: [{ kind: "file", path: "pasted-image.png" }],
          words: "",
        }),
      ),
    ).toBe(false);
    expect(isEmptyDraft(draft())).toBe(false);
  });

  it.each([
    ["DRAFT.md", true],
    ["DRAFT 2.md", true],
    ["DRAFT.sync-conflict-20261014-dev_B.md", true],
    ["draft.md", false],
    ["DRAFT.txt", false],
    ["notes.md", false],
  ])("reads %s as a draft's file: %s", (name, is) => {
    expect(isDraftFileName(name)).toBe(is);
  });
});
