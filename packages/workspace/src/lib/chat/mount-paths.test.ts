import { describe, expect, it } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import {
  type FolderMounts,
  mountAliases,
  mountPathOf,
  toChatPaths,
  toTaskPaths,
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

/** A task the conversation handed Downloads, under the conversation's path for it. */
const handedDownloads = mounts({
  "Home/Downloads": "/Users/x/Downloads",
  Instrument: "/Users/x/Documents/Instrument",
});

/** A task handed Downloads before names were shared, under a name of its own. */
const namedItsOwnWay = mounts({
  Downloads: "/Users/x/Downloads",
  Instrument: "/Users/x/Documents/Instrument",
});

describe("mountAliases", () => {
  it("reads a shared name as the conversation's path", () => {
    expect(mountAliases(conversation, handedDownloads)).toMatchInlineSnapshot(`
      [
        {
          "chatPath": "/mnt/Home/Downloads",
          "taskPath": "/mnt/Home/Downloads",
        },
        {
          "chatPath": "/mnt/Instrument",
          "taskPath": "/mnt/Instrument",
        },
      ]
    `);
  });

  it("finds a name of the task's own by the folder on disk", () => {
    expect(mountAliases(conversation, namedItsOwnWay)[0])
      .toMatchInlineSnapshot(`
      {
        "chatPath": "/mnt/Home/Downloads",
        "taskPath": "/mnt/Downloads",
      }
    `);
  });

  it("does not take a namesake of the conversation's for the folder", () => {
    // The task's Instrument is a folder of the user's; the conversation's is
    // the workspace folder.
    const handedTheNamesake = mounts({
      Instrument: "/Users/x/code/Instrument",
    });
    expect(mountAliases(conversation, handedTheNamesake))
      .toMatchInlineSnapshot(`
      [
        {
          "chatPath": "/mnt/Home/code/Instrument",
          "taskPath": "/mnt/Instrument",
        },
      ]
    `);
  });

  it("has no conversation path for a folder the conversation no longer reaches", () => {
    expect(
      mountAliases(conversation, mounts({ Archive: "/Volumes/Archive" })),
    ).toEqual([{ chatPath: undefined, taskPath: "/mnt/Archive" }]);
  });
});

describe("toTaskPaths and toChatPaths", () => {
  it("leaves text alone where the two share every name", () => {
    const text =
      "The invoices are in /mnt/Home/Downloads; write the summary to /mnt/Instrument/invoices/summary.md.";
    const aliases = mountAliases(conversation, handedDownloads);
    expect(toTaskPaths(text, aliases)).toBe(text);
    expect(toChatPaths(text, aliases)).toBe(text);
  });

  it("swaps a task's own name for the conversation's path, both ways", () => {
    const aliases = mountAliases(conversation, namedItsOwnWay);
    expect(
      toTaskPaths(
        "Read /mnt/Home/Downloads/a.pdf, then /mnt/Home/Downloads.",
        aliases,
      ),
    ).toMatchInlineSnapshot(
      `"Read /mnt/Downloads/a.pdf, then /mnt/Downloads."`,
    );
    expect(
      toChatPaths(
        "Wrote [the summary](/mnt/Downloads/summary.md) beside `/mnt/Downloads/raw.csv`.",
        aliases,
      ),
    ).toMatchInlineSnapshot(
      `"Wrote [the summary](/mnt/Home/Downloads/summary.md) beside \`/mnt/Home/Downloads/raw.csv\`."`,
    );
  });

  it("swaps only a whole name", () => {
    const aliases = mountAliases(conversation, namedItsOwnWay);
    expect(
      toChatPaths("/mnt/Downloads-old/a.md and /mnt/Downloads.bak", aliases),
    ).toMatchInlineSnapshot(`"/mnt/Downloads-old/a.md and /mnt/Downloads.bak"`);
  });

  it("leaves a mount nobody has alone", () => {
    const aliases = mountAliases(conversation, namedItsOwnWay);
    expect(toTaskPaths("/mnt/Photos/holiday.jpg", aliases)).toBe(
      "/mnt/Photos/holiday.jpg",
    );
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
