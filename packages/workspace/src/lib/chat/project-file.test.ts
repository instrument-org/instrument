import { describe, expect, it } from "vitest";

import {
  listedFolderPaths,
  parseProjectFile,
  renderProjectFile,
  type ProjectFile,
  toTheSecond,
} from "./project-file";

/** When the file was last written, for a project whose front matter says no. */
const AT = new Date("2026-10-16T18:04:11.231Z");

const KITCHEN: ProjectFile = {
  about: "Kitchen plans and appliances",
  color: "amber",
  created: new Date("2026-09-02T09:14:00Z"),
  emoji: "🍳",
  id: "top_01K8ZQ2N4C",
  instructions:
    "The standing instructions every chat under this project is read with.",
};

describe("renderProjectFile", () => {
  it("writes the front matter a person reads, then the instructions", () => {
    expect(renderProjectFile(KITCHEN)).toMatchInlineSnapshot(`
      "---
      id: top_01K8ZQ2N4C
      emoji: 🍳
      color: amber
      about: Kitchen plans and appliances
      created: 2026-09-02T09:14:00Z
      ---

      The standing instructions every chat under this project is read with.
      "
    `);
  });

  it("writes a project with nothing but an id and a date", () => {
    expect(renderProjectFile({ created: KITCHEN.created, id: "top_1" }))
      .toMatchInlineSnapshot(`
        "---
        id: top_1
        created: 2026-09-02T09:14:00Z
        ---
        "
      `);
  });

  it("names retired only when it is", () => {
    expect(renderProjectFile({ ...KITCHEN, retired: false })).not.toContain(
      "retired",
    );
    expect(renderProjectFile({ ...KITCHEN, retired: true })).toContain(
      "retired: true",
    );
  });

  it("quotes what YAML would read as something else", () => {
    const file = renderProjectFile({
      ...KITCHEN,
      about: "Dishwashers: quiet ones",
      color: "true",
    });

    expect(file).toContain('about: "Dishwashers: quiet ones"');
    expect(file).toContain('color: "true"');
    expect(parseProjectFile(file, { at: AT })?.color).toBe("true");
  });

  it("leaves a long line long rather than folding it", () => {
    const about = "a kitchen ".repeat(20).trim();

    const file = renderProjectFile({ ...KITCHEN, about });

    expect(file).toContain(`about: ${about}\n`);
    expect(parseProjectFile(file, { at: AT })?.about).toBe(about);
  });
});

describe("parseProjectFile", () => {
  it("round-trips a project with every key", () => {
    const project: ProjectFile = {
      ...KITCHEN,
      others: {
        projectId: "prj_01KXB5K5ZSQNZ8NQJPQRYRAAS1",
        seen: ["phone"],
        sortsAfter: "Trips",
      },
      retired: true,
    };

    expect(parseProjectFile(renderProjectFile(project), { at: AT })).toEqual(
      project,
    );
  });

  it("takes the instructions as the body, however it is spaced", () => {
    const parsed = parseProjectFile(
      "---\nid: top_1\n---\n\n\n  Aisle seats.\n\n",
      { at: AT },
    );

    expect(parsed?.instructions).toBe("Aisle seats.");
  });

  it("reads when the file was written as the created it does not hold", () => {
    expect(
      parseProjectFile("---\nid: top_1\n---\n", { at: AT })?.created,
    ).toEqual(new Date("2026-10-16T18:04:11.000Z"));
  });

  it.each([
    ["front matter with no id", "---\nemoji: 🍳\n---\n"],
    ["an id that is only spaces", "---\nid: '  '\n---\n"],
  ])("reads no id from %s", (_case, text) => {
    expect(parseProjectFile(text, { at: AT })).not.toHaveProperty("id");
  });

  // An `AGENTS.md` the person copied in: every word of it is the project's
  // instructions, so the app's next write keeps them under its front matter.
  it.each([
    [
      "no front matter",
      "# Garden\n\nWater on Sundays.\n",
      "# Garden\n\nWater on Sundays.",
    ],
    [
      "front matter that is not a map",
      "---\n- one\n---\nWords.\n",
      "---\n- one\n---\nWords.",
    ],
    [
      "front matter YAML cannot read",
      "---\nid: 'top_1\n---\nWords.\n",
      "---\nid: 'top_1\n---\nWords.",
    ],
  ])(
    "reads a file with %s as all instructions",
    (_case, text, instructions) => {
      expect(parseProjectFile(text, { at: AT })).toEqual({
        created: toTheSecond(AT),
        instructions,
      });
    },
  );

  it("reads a date-only created as that day", () => {
    const parsed = parseProjectFile(
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
    const parsed = parseProjectFile(
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
