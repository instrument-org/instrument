import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildAttachedFoldersText } from "./build-attached-folders-text";

const INTRO = "The user has attached these folders to this task:";

function listOf(text: string): string[] {
  return text.split("\n").filter((line) => line.startsWith("- "));
}

describe("buildAttachedFoldersText", () => {
  // The bug this exists to prevent: the model reads back the mount name as
  // though it were the folder's name, and the user is told about a
  // "documents-test" folder they never created.
  it("names a folder the way the user does, whatever its mount is called", () => {
    const text = buildAttachedFoldersText({
      folders: [
        {
          access: "read-write",
          mountPoint: "/mnt/Documents-test",
          path: "/Users/sam/Documents/test",
        },
      ],
      intro: INTRO,
    });

    expect(listOf(text)).toMatchInlineSnapshot(`
      [
        "- "test" -> \`/mnt/Documents-test\` (read and write)",
      ]
    `);
  });

  it("tells the model to speak the name and address the mount", () => {
    const text = buildAttachedFoldersText({
      folders: [
        { access: "read-only", mountPoint: "/mnt/notes", path: "/tmp/notes" },
      ],
      intro: INTRO,
    });

    expect(text).toContain("Call a folder by its quoted name");
    expect(text).toContain("never present one as the folder's name");
  });

  it("leaves a name unqualified when nothing else shares it", () => {
    const text = buildAttachedFoldersText({
      folders: [
        { access: "read-only", mountPoint: "/mnt/test", path: "/tmp/a/test" },
        { access: "read-only", mountPoint: "/mnt/notes", path: "/tmp/b/notes" },
      ],
      intro: INTRO,
    });

    expect(listOf(text)).toMatchInlineSnapshot(`
      [
        "- "test" -> \`/mnt/test\` (read-only)",
        "- "notes" -> \`/mnt/notes\` (read-only)",
      ]
    `);
  });

  // Both sides get the hint, not just the one whose mount name was qualified:
  // "test" alone is no more use to the user than "test" alone.
  it("points at the parent of each folder in a name collision", () => {
    const text = buildAttachedFoldersText({
      folders: [
        {
          access: "read-write",
          mountPoint: "/mnt/test",
          path: "/Users/sam/Downloads/test",
        },
        {
          access: "read-only",
          mountPoint: "/mnt/Documents-test",
          path: "/Users/sam/Documents/test",
        },
      ],
      intro: INTRO,
    });

    expect(listOf(text)).toMatchInlineSnapshot(`
      [
        "- "test" (in Downloads) -> \`/mnt/test\` (read and write)",
        "- "test" (in Documents) -> \`/mnt/Documents-test\` (read-only)",
      ]
    `);
  });

  it("keeps the user's account name out of a parent hint", () => {
    const text = buildAttachedFoldersText({
      folders: [
        {
          access: "read-only",
          mountPoint: "/mnt/test",
          path: path.join(os.homedir(), "test"),
        },
        {
          access: "read-only",
          mountPoint: "/mnt/Documents-test",
          path: path.join(os.homedir(), "Documents", "test"),
        },
      ],
      intro: INTRO,
    });

    expect(listOf(text)).toMatchInlineSnapshot(`
      [
        "- "test" (in Home) -> \`/mnt/test\` (read-only)",
        "- "test" (in Documents) -> \`/mnt/Documents-test\` (read-only)",
      ]
    `);
    expect(text).not.toContain(path.basename(os.homedir()));
  });

  it("marks a folder that is no longer on disk", () => {
    const text = buildAttachedFoldersText({
      folders: [
        {
          access: "read-write",
          missing: true,
          mountPoint: "/mnt/test",
          path: "/tmp/gone/test",
        },
      ],
      intro: INTRO,
    });

    expect(listOf(text)).toMatchInlineSnapshot(`
      [
        "- "test" -> \`/mnt/test\` (read and write, no longer exists)",
      ]
    `);
  });
});
