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
      created: 2026-10-14T18:22:04Z
      updated: 2026-10-14T18:22:04Z
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
      created: 2026-10-14T18:22:04Z
      updated: 2026-10-14T18:22:04Z
      chat: instrument://chat/2026-10-14-quiet-dishwashers
      topic: "tpc_01KF"
      ---

      Find a quiet dishwasher.
      "
    `);
  });

  it.each([
    ["its address", "instrument://chat/2026-10-14-quiet-dishwashers"],
    ["a bare id", "2026-10-14-quiet-dishwashers"],
  ])("reads the chat named by %s", (_name, chat) => {
    expect(
      parseDraftFile(`---\nid: "d1"\nchat: ${chat}\n---\n\nWords.\n`, {
        at: AT,
      })?.chat,
    ).toBe("2026-10-14-quiet-dishwashers");
  });

  it("writes the chat a draft is on its way into apart from the chat a reply is for", () => {
    const written = draft({ sending: "2026-10-19-latest-tweet" });
    expect(renderDraftFile(written)).toContain(
      "sending: instrument://chat/2026-10-19-latest-tweet",
    );
    expect(roundTrip(written)).toMatchObject({
      sending: "2026-10-19-latest-tweet",
    });
    expect(roundTrip(written)?.chat).toBeUndefined();
  });

  it("names the device asked to send a reply, as its own key", () => {
    const written = draft({
      chat: "2026-10-19-latest-tweet",
      send: "dev_7Q2M4K9X",
    });
    expect(renderDraftFile(written)).toContain('send: "dev_7Q2M4K9X"');
    expect(roundTrip(written)).toMatchObject({ send: "dev_7Q2M4K9X" });
    expect(roundTrip(written)?.others).toBeUndefined();
  });

  it("lists what goes with the message one line each", () => {
    const written = draft({
      context: [
        "pasted-image.png",
        "workspace:/Kitchen plans/",
        "/Users/someone/Documents/quote: final.pdf",
        "instrument://chat/2026-10-12-oven-research-2p9d",
      ],
    });
    expect(renderDraftFile(written)).toMatchInlineSnapshot(`
      "---
      id: "01KFDRAFT0000000000000001"
      created: 2026-10-14T18:22:04Z
      updated: 2026-10-14T18:22:04Z
      context:
        - "pasted-image.png"
        - "workspace:/Kitchen plans/"
        - "/Users/someone/Documents/quote: final.pdf"
        - "instrument://chat/2026-10-12-oven-research-2p9d"
      ---

      Find a quiet dishwasher.
      "
    `);
    expect(roundTrip(written)?.context).toEqual(written.context);
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

  it("is no draft without an id unless it is given one", () => {
    expect(parseDraftFile("Just some words.\n", { at: AT })).toBeUndefined();
    expect(
      parseDraftFile("---\ntopic: tpc_01KF\n---\n\nWords.\n", { at: AT }),
    ).toBeUndefined();
  });

  it.each([
    [
      "front matter with no id",
      "---\ntopic: tpc_01KF\n---\nCall the plumber.\n",
    ],
    ["no front matter", "Call the plumber.\n"],
  ])(
    "reads a draft written by hand with %s under the id it is given",
    (_name, text) => {
      expect(parseDraftFile(text, { at: AT, newId: "d9" })).toMatchObject({
        id: "d9",
        words: "Call the plumber.",
      });
    },
  );

  it.each([
    ["front matter that is not YAML", "---\nid: [1, 2\n---\n"],
    ["front matter that never closes", "---\nid: d1\nWords.\n"],
    ["nothing at all", ""],
  ])("is no draft with %s", (_name, text) => {
    expect(parseDraftFile(text, { at: AT, newId: "d9" })).toBeUndefined();
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

  it("holds nothing when it has no words and nothing was pasted into it", () => {
    expect(isEmptyDraft(draft({ words: "   \n" }))).toBe(true);
    expect(
      isEmptyDraft(
        draft({
          context: ["instrument://chat/2026-10-12-oven", "/Users/sam/a.pdf"],
          words: "",
        }),
      ),
    ).toBe(true);
    expect(
      isEmptyDraft(draft({ context: ["pasted-image.png"], words: "" })),
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
