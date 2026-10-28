import { describe, expect, it } from "vitest";

import {
  listedFolderPaths,
  parseTopicFile,
  renderTopicFile,
  type TopicFile,
} from "./topic-file";

/** When the file was last written, for a topic whose front matter says no. */
const AT = new Date("2026-10-16T18:04:11.231Z");

const KITCHEN: TopicFile = {
  about: "Kitchen plans and appliances",
  color: "amber",
  created: new Date("2026-09-02T09:14:00Z"),
  emoji: "🍳",
  id: "top_01K8ZQ2N4C",
  instructions:
    "The standing instructions every chat under this topic is read with.",
};

describe("renderTopicFile", () => {
  it("writes the front matter a person reads, then the instructions", () => {
    expect(renderTopicFile(KITCHEN)).toMatchInlineSnapshot(`
      "---
      id: top_01K8ZQ2N4C
      emoji: 🍳
      color: amber
      about: Kitchen plans and appliances
      created: 2026-09-02T09:14:00Z
      ---

      The standing instructions every chat under this topic is read with.
      "
    `);
  });

  it("writes a topic with nothing but an id and a date", () => {
    expect(renderTopicFile({ created: KITCHEN.created, id: "top_1" }))
      .toMatchInlineSnapshot(`
        "---
        id: top_1
        created: 2026-09-02T09:14:00Z
        ---
        "
      `);
  });

  it("writes the icon a topic wears after its emoji, and reads it back", () => {
    const { emoji: _emoji, ...rest } = KITCHEN;
    const file = renderTopicFile({ ...rest, icon: "CookingPot" });
    expect(file).toContain(
      "id: top_01K8ZQ2N4C\nicon: CookingPot\ncolor: amber",
    );
    expect(parseTopicFile(file, { at: AT })?.icon).toBe("CookingPot");
  });

  it("names retired only when it is", () => {
    expect(renderTopicFile({ ...KITCHEN, retired: false })).not.toContain(
      "retired",
    );
    expect(renderTopicFile({ ...KITCHEN, retired: true })).toContain(
      "retired: true",
    );
  });

  it("quotes what YAML would read as something else", () => {
    const file = renderTopicFile({
      ...KITCHEN,
      about: "Dishwashers: quiet ones",
      color: "true",
    });

    expect(file).toContain('about: "Dishwashers: quiet ones"');
    expect(file).toContain('color: "true"');
    expect(parseTopicFile(file, { at: AT })?.color).toBe("true");
  });

  it("leaves a long line long rather than folding it", () => {
    const about = "a kitchen ".repeat(20).trim();

    const file = renderTopicFile({ ...KITCHEN, about });

    expect(file).toContain(`about: ${about}\n`);
    expect(parseTopicFile(file, { at: AT })?.about).toBe(about);
  });
});

describe("parseTopicFile", () => {
  it("round-trips a topic with every key", () => {
    const topic: TopicFile = {
      ...KITCHEN,
      others: { seen: ["phone"], sortsAfter: "Trips" },
      projectId: "prj_01KXB5K5ZSQNZ8NQJPQRYRAAS1",
      retired: true,
    };

    expect(parseTopicFile(renderTopicFile(topic), { at: AT })).toEqual(topic);
  });

  it("takes the instructions as the body, however it is spaced", () => {
    const parsed = parseTopicFile(
      "---\nid: top_1\n---\n\n\n  Aisle seats.\n\n",
      { at: AT },
    );

    expect(parsed?.instructions).toBe("Aisle seats.");
  });

  it("reads when the file was written as the created it does not hold", () => {
    expect(
      parseTopicFile("---\nid: top_1\n---\n", { at: AT })?.created,
    ).toEqual(new Date("2026-10-16T18:04:11.000Z"));
  });

  it.each([
    ["no front matter", "Just some words.\n"],
    ["front matter with no id", "---\nemoji: 🍳\n---\n"],
    ["an id that is only spaces", "---\nid: '  '\n---\n"],
    ["front matter that is not a map", "---\n- one\n---\n"],
    ["front matter YAML cannot read", "---\nid: 'top_1\n---\n"],
  ])("reads no topic from %s", (_case, text) => {
    expect(parseTopicFile(text, { at: AT })).toBeUndefined();
  });

  it("reads a date-only created as that day", () => {
    const parsed = parseTopicFile(
      "---\nid: top_1\ncreated: 2026-09-02\n---\n",
      {
        at: AT,
      },
    );

    expect(parsed?.created).toEqual(new Date("2026-09-02"));
  });

  // Folders are granted on one computer, in its permission settings; a
  // `folders:` key is one this build does not read.
  it("reads a folders list as a key it does not know, kept as written", () => {
    const parsed = parseTopicFile(
      "---\nid: top_1\nfolders:\n  - path: /Users/someone/Deals\n---\n",
      { at: AT },
    );

    expect(parsed).not.toHaveProperty("folders");
    expect(parsed?.others).toEqual({
      folders: [{ path: "/Users/someone/Deals" }],
    });
  });
});

describe("listedFolderPaths", () => {
  it.each([
    [[{ path: "/Users/someone/Deals" }], ["/Users/someone/Deals"]],
    [["/Users/someone/Deals"], ["/Users/someone/Deals"]],
    [[{ path: "" }, 7], []],
    ["/Users/someone/Deals", []],
  ])("reads %j as %j", (value, expected) => {
    expect(listedFolderPaths(value)).toEqual(expected);
  });
});
