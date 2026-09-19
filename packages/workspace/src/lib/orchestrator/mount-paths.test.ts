import { describe, expect, it } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import {
  type FolderMounts,
  mountPathOf,
  translateMountPaths,
  translateTaskFolderPaths,
} from "./mount-paths";

function mounts(paths: Record<string, string>): FolderMounts {
  return Object.fromEntries(
    Object.entries(paths).map(([mountName, path]) => [
      mountName,
      { mountName, path },
    ]),
  );
}

/** A conversation holding the user's home folder and the workspace folder. */
const conversation = mounts({
  Home: "/Users/x",
  Instrument: "/Users/x/Documents/Instrument",
});

/** A task of its own, handed Downloads and the workspace folder it always has. */
const task = mounts({
  Downloads: "/Users/x/Downloads",
  Instrument: "/Users/x/Documents/Instrument",
});

describe("translateMountPaths", () => {
  it("reads a folder inside the conversation's mount under the task's own name for it", () => {
    expect(
      translateMountPaths(
        "The invoices are in /mnt/Home/Downloads; write the summary to /mnt/Instrument/invoices/summary.md.",
        conversation,
        task,
      ),
    ).toMatchInlineSnapshot(
      `"The invoices are in /mnt/Downloads; write the summary to /mnt/Instrument/invoices/summary.md."`,
    );
  });

  it("reads a task's own path back under the conversation's name for it", () => {
    expect(
      translateMountPaths(
        "Wrote /mnt/Downloads/summary.md.",
        task,
        conversation,
      ),
    ).toMatchInlineSnapshot(`"Wrote /mnt/Home/Downloads/summary.md."`);
  });

  it("keeps a name that means one folder here and another there apart", () => {
    // The user has a folder of their own called Instrument. The conversation
    // mounts the workspace under that name and the folder under another; the
    // task it hands the folder to does the reverse.
    const withNamesake = mounts({
      "code-Instrument": "/Users/x/code/Instrument",
      Instrument: "/Users/x/Documents/Instrument",
    });
    const handedTheNamesake = mounts({
      "Documents-Instrument": "/Users/x/Documents/Instrument",
      Instrument: "/Users/x/code/Instrument",
    });
    expect(
      translateMountPaths(
        "Read /mnt/code-Instrument/README.md and put the notes in /mnt/Instrument/notes.md.",
        withNamesake,
        handedTheNamesake,
      ),
    ).toMatchInlineSnapshot(
      `"Read /mnt/Instrument/README.md and put the notes in /mnt/Documents-Instrument/notes.md."`,
    );
  });

  it("leaves a folder the reading side does not have exactly as it was", () => {
    expect(
      translateMountPaths(
        "Check /mnt/Home/Desktop/notes.txt first.",
        conversation,
        task,
      ),
    ).toMatchInlineSnapshot(`"Check /mnt/Home/Desktop/notes.txt first."`);
  });

  it("does not read a longer name as a shorter one with something under it", () => {
    const twoNamesakes = mounts({
      Home: "/Users/x",
      "Home-Downloads": "/Users/x/Downloads",
    });
    expect(
      translateMountPaths(
        "/mnt/Home-Downloads/a.md and /mnt/Home/b.md",
        twoNamesakes,
        mounts({ Downloads: "/Users/x/Downloads", Home: "/Users/x" }),
      ),
    ).toMatchInlineSnapshot(`"/mnt/Downloads/a.md and /mnt/Home/b.md"`);
  });

  it("carries a name with a space in it", () => {
    expect(
      translateMountPaths(
        "It goes in /mnt/Home/My Notes/today.md, nowhere else.",
        conversation,
        mounts({ "My Notes": "/Users/x/My Notes" }),
      ),
    ).toMatchInlineSnapshot(
      `"It goes in /mnt/My Notes/today.md, nowhere else."`,
    );
  });

  it("ends a path where a sentence ends", () => {
    expect(
      translateMountPaths(
        "Everything is in /mnt/Home/Downloads.",
        conversation,
        task,
      ),
    ).toMatchInlineSnapshot(`"Everything is in /mnt/Downloads."`);
  });

  it("leaves the access suffix on a folder spec alone", () => {
    expect(
      translateMountPaths(
        "--folder /mnt/Home/Downloads:rw",
        conversation,
        task,
      ),
    ).toMatchInlineSnapshot(`"--folder /mnt/Downloads:rw"`);
  });

  it("stops at the folder it finds rather than running on into the sentence", () => {
    expect(
      translateMountPaths(
        "Put it in /mnt/Home/Downloads and say when /mnt/Home/Desktop is clear.",
        conversation,
        mounts({
          Desktop: "/Users/x/Desktop",
          Downloads: "/Users/x/Downloads",
        }),
      ),
    ).toMatchInlineSnapshot(
      `"Put it in /mnt/Downloads and say when /mnt/Desktop is clear."`,
    );
  });

  it("takes a path out of a link and out of backticks", () => {
    expect(
      translateMountPaths(
        "Wrote [the summary](/mnt/Downloads/summary.md) beside `/mnt/Downloads/raw.csv`.",
        task,
        conversation,
      ),
    ).toMatchInlineSnapshot(
      `"Wrote [the summary](/mnt/Home/Downloads/summary.md) beside \`/mnt/Home/Downloads/raw.csv\`."`,
    );
  });

  it("leaves a path that climbs out of its mount where it was", () => {
    expect(
      translateMountPaths("/mnt/Downloads/../.ssh/id_rsa", task, conversation),
    ).toMatchInlineSnapshot(`"/mnt/Downloads/../.ssh/id_rsa"`);
  });

  it("leaves a mount nobody has alone", () => {
    expect(
      translateMountPaths("/mnt/Photos/holiday.jpg", conversation, task),
    ).toMatchInlineSnapshot(`"/mnt/Photos/holiday.jpg"`);
  });

  it("returns text with no path in it untouched", () => {
    const text = "Two paragraphs and no folder in either of them.";
    expect(translateMountPaths(text, conversation, task)).toBe(text);
  });
});

describe("mountPathOf", () => {
  it("reaches a folder through the deepest mount that covers it", () => {
    expect(
      mountPathOf("/Users/x/Documents/Instrument/notes.md", conversation),
    ).toMatchInlineSnapshot(`"/mnt/Instrument/notes.md"`);
  });

  it("has no path for a folder no mount covers", () => {
    expect(mountPathOf("/Volumes/Archive", conversation)).toMatchInlineSnapshot(
      `undefined`,
    );
  });
});

describe("translateTaskFolderPaths", () => {
  const taskId = TaskIdSchema.parse("2026-09-17-build-the-digest");

  it("rewrites the task's own folder wherever it is named absolutely", () => {
    expect(
      translateTaskFolderPaths(
        "Built at /task/work/digest.html and checked it.",
        taskId,
      ),
    ).toMatchInlineSnapshot(
      `"Built at /tasks/2026-09-17-build-the-digest/work/digest.html and checked it."`,
    );
  });

  it("rewrites the relative lines of a files fence and leaves absolute ones", () => {
    const receipt = [
      "Done. The page and the script it came from:",
      "",
      "```files",
      "work/digest.html",
      "./work/build.mjs",
      "/mnt/Instrument/digest.html",
      "",
      "```",
    ].join("\n");
    expect(translateTaskFolderPaths(receipt, taskId)).toMatchInlineSnapshot(`
      "Done. The page and the script it came from:

      \`\`\`files
      /tasks/2026-09-17-build-the-digest/work/digest.html
      /tasks/2026-09-17-build-the-digest/work/build.mjs
      /mnt/Instrument/digest.html
      \`\`\`"
    `);
  });

  it("leaves a relative path in prose alone, since a sentence is not a fence", () => {
    const text = "The script is in work/build.mjs beside the page.";
    expect(translateTaskFolderPaths(text, taskId)).toBe(text);
  });

  // The task's root is a whole path's start, never a segment of another
  // path or an address: a folder of the user's and a page on a site both
  // stay as they were written.
  it("leaves the same word inside another path or an address alone", () => {
    const text = [
      "Filed at https://app.example.com/task/42 and copied to /mnt/Home/Projects/task/notes.md.",
      "The build is at /task/work/build.mjs (log in `/task/work/build.log`).",
    ].join("\n");
    expect(translateTaskFolderPaths(text, taskId)).toMatchInlineSnapshot(`
      "Filed at https://app.example.com/task/42 and copied to /mnt/Home/Projects/task/notes.md.
      The build is at /tasks/2026-09-17-build-the-digest/work/build.mjs (log in \`/tasks/2026-09-17-build-the-digest/work/build.log\`)."
    `);
  });

  // The decorations the parser tolerates come off before the root goes on,
  // so a bulleted or backticked line becomes a path rather than a bullet
  // with a path inside it.
  it("reads a fence the way the parser does before prefixing its lines", () => {
    const receipt = [
      "Done.",
      "",
      "```files",
      "- work/report.html",
      "`work/data.csv`",
      "[the page](work/index.html)",
      "/mnt/Instrument/digest.html",
      "```",
    ].join("\n");
    expect(translateTaskFolderPaths(receipt, taskId)).toMatchInlineSnapshot(`
      "Done.

      \`\`\`files
      /tasks/2026-09-17-build-the-digest/work/report.html
      /tasks/2026-09-17-build-the-digest/work/data.csv
      /tasks/2026-09-17-build-the-digest/work/index.html
      /mnt/Instrument/digest.html
      \`\`\`"
    `);
  });
});
