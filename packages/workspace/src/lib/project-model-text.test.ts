import { describe, expect, it } from "vitest";

import { projectModelNote } from "./project-model-text";

describe("projectModelNote", () => {
  it("names the project, then gives its instructions and folders", () => {
    expect(
      projectModelNote({
        project: {
          about: "getting away",
          emoji: "✈️",
          folders: ["/Users/sam/Trips", "/Users/sam/Receipts"],
          instructions: "Book aisle seats.\n\nKeep hotels under $200 a night.",
          name: "Travel",
        },
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      This chat is filed under the project ✈️ "Travel" (getting away); read the chat through it. Its folder, \`Projects/Travel/\` in the user's Instrument folder, is where the project's lasting files are kept, so a finished file the user gave no place for goes there.

      The user's instructions for every chat under "Travel":
      <project_instructions>
      Book aisle seats.

      Keep hotels under $200 a night.
      </project_instructions>

      Folders the work under "Travel" uses, attached to this chat: \`/Users/sam/Trips\`, \`/Users/sam/Receipts\`.
      </instrument-system-note>"
    `);
  });

  it("says the chat has no project once it is taken off", () => {
    expect(projectModelNote({ project: null })).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      This chat has no project now.
      </instrument-system-note>"
    `);
  });

  it("cuts long instructions on a paragraph break, naming the project's own file", () => {
    const note = projectModelNote({
      project: {
        instructions: `${"a".repeat(19_990)}\n\n${"ZZZ ".repeat(30)}`,
        name: "Long",
      },
    });
    expect(note).not.toContain("ZZZ");
    expect(note).toContain(
      "[Cut off here: the rest is in Projects/Long/AGENTS.md.]",
    );
  });
});
