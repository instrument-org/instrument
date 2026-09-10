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
    expect(text).toContain("The mount path is its address, not its name");
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

  // The orchestrator has no file tools and a shell that refuses to write, so
  // its copy names the task as the writer rather than tools it has not got.
  it("names a task as the writer for a reader without file tools", () => {
    const folders = [
      {
        access: "read-write" as const,
        mountPoint: "/mnt/Instrument",
        path: "/Users/sam/Documents/Instrument",
      },
      {
        access: "read-only" as const,
        mountPoint: "/mnt/sam",
        path: "/Users/sam",
      },
    ];
    const here = buildAttachedFoldersText({ folders, intro: INTRO });
    const throughTasks = buildAttachedFoldersText({
      folders,
      intro: INTRO,
      writes: "through-tasks",
    });

    expect(here).toContain("write_file");
    expect(throughTasks).not.toContain("write_file");
    expect(throughTasks).not.toContain("edit_file");
    expect(throughTasks).not.toContain("read_file");
    expect(throughTasks).toContain("--folder");
    expect(throughTasks).toContain("Writing into a read-only folder fails");
    expect(listOf(throughTasks)).toEqual(listOf(here));
  });

  it("labels the home folder as writable inside without calling it read-only", () => {
    const text = buildAttachedFoldersText({
      folders: [
        {
          access: "read-only",
          mountPoint: "/mnt/sam",
          path: "/Users/sam",
          writableInside: true,
        },
      ],
      intro: INTRO,
      writes: "through-tasks",
    });

    expect(listOf(text)).toMatchInlineSnapshot(`
      [
        "- "sam" -> \`/mnt/sam\` (read-only as a whole, read and write inside)",
      ]
    `);
    expect(text).not.toContain("Writing into a read-only folder fails");
  });

  it.runIf(process.platform === "darwin")(
    "tells a reader with file tools what a refusal from macOS looks like",
    () => {
      const folders = [
        {
          access: "read-write" as const,
          mountPoint: "/mnt/Desktop",
          path: "/Users/sam/Desktop",
        },
      ];
      expect(buildAttachedFoldersText({ folders, intro: INTRO })).toContain(
        "Operation not permitted",
      );
      expect(
        buildAttachedFoldersText({
          folders,
          intro: INTRO,
          writes: "through-tasks",
        }),
      ).not.toContain("Operation not permitted");
    },
  );

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
