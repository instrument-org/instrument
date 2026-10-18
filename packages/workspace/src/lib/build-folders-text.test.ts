import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildFoldersText } from "./build-folders-text";

const INTRO = "The user has attached these folders to this task:";

function listOf(text: string): string[] {
  return text.split("\n").filter((line) => line.startsWith("- "));
}

describe("buildFoldersText", () => {
  // The bug this exists to prevent: the model reads back a path segment as
  // though it were the folder's name, and the user is told about a
  // "documents-test" folder they never created.
  it("names a folder the way the user does, whatever its path is", () => {
    const text = buildFoldersText({
      folders: [
        {
          access: "read-write",
          path: "/Users/sam/Documents/test",
        },
      ],
      intro: INTRO,
    });

    expect(listOf(text)).toMatchInlineSnapshot(`
      [
        "- "test" -> \`/Users/sam/Documents/test\` (read and write)",
      ]
    `);
  });

  it("tells the model to speak the name and address the path", () => {
    const text = buildFoldersText({
      folders: [{ access: "read-only", path: "/tmp/notes" }],
      intro: INTRO,
    });

    expect(text).toContain("Call a folder by its quoted name");
    expect(text).toContain("The path is its address, not its name");
  });

  it("leaves a name unqualified when nothing else shares it", () => {
    const text = buildFoldersText({
      folders: [
        { access: "read-only", path: "/tmp/a/test" },
        {
          access: "read-only",
          path: "/tmp/b/notes",
        },
      ],
      intro: INTRO,
    });

    expect(listOf(text)).toMatchInlineSnapshot(`
      [
        "- "test" -> \`/tmp/a/test\` (read-only)",
        "- "notes" -> \`/tmp/b/notes\` (read-only)",
      ]
    `);
  });

  // Both sides get the hint, not just the one whose mount name was qualified:
  // "test" alone is no more use to the user than "test" alone.
  it("points at the parent of each folder in a name collision", () => {
    const text = buildFoldersText({
      folders: [
        {
          access: "read-write",
          path: "/Users/sam/Downloads/test",
        },
        {
          access: "read-only",
          path: "/Users/sam/Documents/test",
        },
      ],
      intro: INTRO,
    });

    expect(listOf(text)).toMatchInlineSnapshot(`
      [
        "- "test" (in Downloads) -> \`/Users/sam/Downloads/test\` (read and write)",
        "- "test" (in Documents) -> \`/Users/sam/Documents/test\` (read-only)",
      ]
    `);
  });

  it("keeps the user's account name out of a parent hint", () => {
    const text = buildFoldersText({
      folders: [
        {
          access: "read-only",
          path: path.join(os.homedir(), "test"),
        },
        {
          access: "read-only",
          path: path.join(os.homedir(), "Documents", "test"),
        },
      ],
      intro: INTRO,
    });

    const hints = listOf(text).map((line) => /\(in ([^)]*)\)/.exec(line)?.[1]);
    expect(hints).toEqual(["Home", "Documents"]);
  });

  // The chat has no file tools and a shell that refuses to write, so
  // its copy names the task as the writer rather than tools it has not got.
  it("labels the home folder as one to look through and ask inside", () => {
    const text = buildFoldersText({
      folders: [
        {
          access: "read-only",
          path: "/Users/sam",
          writableInside: true,
        },
      ],
      intro: INTRO,
    });

    expect(listOf(text)).toMatchInlineSnapshot(`
      [
        "- "sam" -> \`/Users/sam\` (look through it; changing anything in it asks the person first)",
      ]
    `);
  });

  it("says a folder that asks is asked for with ask_permission", () => {
    const folders = [
      {
        access: "read-write" as const,
        path: "/Users/sam/Desktop",
      },
    ];
    expect(buildFoldersText({ folders, intro: INTRO })).toContain(
      "Ask for one that needs a yes with `ask_permission`",
    );
  });

  it("marks a folder that is no longer on disk", () => {
    const text = buildFoldersText({
      folders: [
        {
          access: "read-write",
          missing: true,
          path: "/tmp/gone/test",
        },
      ],
      intro: INTRO,
    });

    expect(listOf(text)).toMatchInlineSnapshot(`
      [
        "- "test" -> \`/tmp/gone/test\` (read and write, no longer exists)",
      ]
    `);
  });
});
