import {
  PRIVATE_FOLDER_NAME,
  SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceDirSchema } from "../schemas/paths";
import {
  readTopicsSync,
  TOPIC_FILE_NAME,
  TOPICS_FOLDER_NAME,
} from "./chat/topics";
import { convertTopicsToTopicFiles, moveTopicsToFolder } from "./topics-move";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { workspaceLayout } from "./workspace-layout";

let root: string;
/** Where every build until this one hid them, `.instrument/topics/`. */
const hiddenDir = () => workspaceLayout(root).topicsDir;
const folder = () => path.join(root, TOPICS_FOLDER_NAME);
const previous = getWorkspaceConfig();

/** A topic as the build before this one wrote it: two files, both hidden. */
async function writeOldTopic(
  dir: string,
  name: string,
  { instructions, ...settings }: Record<string, unknown> = {},
): Promise<void> {
  await fs.mkdir(path.join(dir, name, PRIVATE_FOLDER_NAME), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(dir, name, PRIVATE_FOLDER_NAME, SETTINGS_FILE_NAME),
    JSON.stringify({
      createdAt: Date.parse("2026-09-02T14:14:00.921Z"),
      id: `top_${name}`,
      ...settings,
    }),
  );
  if (typeof instructions === "string") {
    await fs.writeFile(
      path.join(dir, name, "instructions.md"),
      `${instructions}\n`,
    );
  }
}

function topicFile(name: string): Promise<string> {
  return fs.readFile(path.join(folder(), name, TOPIC_FILE_NAME), "utf8");
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "topics-move-test-"));
  setWorkspaceConfig({ ...previous, rootDir: WorkspaceDirSchema.parse(root) });
});

afterEach(async () => {
  setWorkspaceConfig(previous);
  await fs.rm(root, { force: true, recursive: true });
});

describe("moveTopicsToFolder", () => {
  it("brings the topics out where the person can read them", async () => {
    await writeOldTopic(hiddenDir(), "Kitchen");

    const moved = await moveTopicsToFolder(root);

    expect(moved).toEqual({ count: 1, kind: "moved", where: folder() });
    await expect(fs.readdir(hiddenDir())).rejects.toThrow();
  });

  it("leaves a Topics folder the person already made alone", async () => {
    await writeOldTopic(hiddenDir(), "Kitchen");
    await writeOldTopic(folder(), "Theirs");

    const moved = await moveTopicsToFolder(root);

    expect(moved).toEqual({ kind: "already-there", where: folder() });
    expect(await fs.readdir(folder())).toEqual(["Theirs"]);
    expect(await fs.readdir(hiddenDir())).toEqual(["Kitchen"]);
  });

  it("does nothing for a workspace with no topics hidden away", async () => {
    expect(await moveTopicsToFolder(root)).toEqual({ kind: "none" });

    await fs.mkdir(hiddenDir(), { recursive: true });
    expect(await moveTopicsToFolder(root)).toEqual({ kind: "none" });
  });

  it("finds nothing to move on a second launch", async () => {
    await writeOldTopic(hiddenDir(), "Kitchen");
    await moveTopicsToFolder(root);

    expect(await moveTopicsToFolder(root)).toEqual({ kind: "none" });
    expect(await fs.readdir(folder())).toEqual(["Kitchen"]);
  });
});

describe("convertTopicsToTopicFiles", () => {
  it("makes one TOPIC.md of the two files, and takes the old ones away", async () => {
    await writeOldTopic(folder(), "Kitchen", {
      about: "Kitchen plans and appliances",
      color: "amber",
      emoji: "🍳",
      folders: [{ path: "/Users/someone/Kitchen plans" }],
      instructions: "The standing instructions.",
      projectId: "prj_01KXB5K5ZSQNZ8NQJPQRYRAAS1",
    });

    const converted = await convertTopicsToTopicFiles(root);

    expect(converted).toEqual({
      done: ["converted Kitchen to TOPIC.md"],
      left: [],
    });
    expect(
      (await topicFile("Kitchen")).replace(/^created: .+$/m, "created: <made>"),
    ).toMatchInlineSnapshot(`
      "---
      id: top_Kitchen
      emoji: 🍳
      color: amber
      about: Kitchen plans and appliances
      created: <made>
      projectId: prj_01KXB5K5ZSQNZ8NQJPQRYRAAS1
      folders:
        - path: /Users/someone/Kitchen plans
      ---

      The standing instructions.
      "
    `);
    expect(await fs.readdir(path.join(folder(), "Kitchen"))).toEqual([
      TOPIC_FILE_NAME,
    ]);
    // And the topic reads back as the one the two files held, its folders a
    // key this build carries for the launch that grants them on this
    // computer (`moveTopicFolders`) and otherwise does not read.
    expect(readTopicsSync(root)).toEqual([
      {
        about: "Kitchen plans and appliances",
        color: "amber",
        created: new Date("2026-09-02T14:14:00.000Z"),
        emoji: "🍳",
        id: "top_Kitchen",
        instructions: "The standing instructions.",
        name: "Kitchen",
        others: { folders: [{ path: "/Users/someone/Kitchen plans" }] },
        projectId: "prj_01KXB5K5ZSQNZ8NQJPQRYRAAS1",
      },
    ]);
  });

  it("keeps a retired topic retired, and a settings key it does not know", async () => {
    await writeOldTopic(folder(), "Trips", {
      retired: true,
      sortsAfter: "Kitchen",
    });

    await convertTopicsToTopicFiles(root);

    const file = await topicFile("Trips");
    expect(file).toContain("retired: true");
    expect(file).toContain("sortsAfter: Kitchen");
  });

  it("leaves a topic that already has its file alone", async () => {
    await writeOldTopic(folder(), "Kitchen", { instructions: "The old ones." });
    await convertTopicsToTopicFiles(root);
    const written = await topicFile("Kitchen");
    // The person edits the file the conversion wrote.
    await fs.writeFile(
      path.join(folder(), "Kitchen", TOPIC_FILE_NAME),
      written.replace("The old ones.", "What I actually want."),
    );
    // And an old settings file turns up again beside it, from a sync.
    await writeOldTopic(folder(), "Kitchen", { instructions: "The old ones." });

    const converted = await convertTopicsToTopicFiles(root);

    expect(converted).toEqual({ done: [], left: [] });
    expect(await topicFile("Kitchen")).toContain("What I actually want.");
    expect(readTopicsSync(root)[0]?.instructions).toBe("What I actually want.");
  });

  it("finds nothing to convert on a second launch", async () => {
    await writeOldTopic(folder(), "Kitchen");
    expect((await convertTopicsToTopicFiles(root)).done).toHaveLength(1);

    expect(await convertTopicsToTopicFiles(root)).toEqual({
      done: [],
      left: [],
    });
  });

  it("leaves a folder of the person's that was never a topic", async () => {
    await fs.mkdir(path.join(folder(), "Scratch"), { recursive: true });
    await fs.writeFile(path.join(folder(), "Scratch", "notes.md"), "mine");

    expect(await convertTopicsToTopicFiles(root)).toEqual({
      done: [],
      left: [],
    });
    expect(await fs.readdir(path.join(folder(), "Scratch"))).toEqual([
      "notes.md",
    ]);
  });

  it("leaves the old files where they are when the settings name no topic", async () => {
    await writeOldTopic(folder(), "Kitchen", { id: 7 });

    const converted = await convertTopicsToTopicFiles(root);

    expect(converted.done).toEqual([]);
    expect(converted.left).toEqual([
      {
        reason: "Error: settings.json names no topic",
        where: path.join(folder(), "Kitchen"),
      },
    ]);
    expect(
      await fs.readdir(path.join(folder(), "Kitchen", PRIVATE_FOLDER_NAME)),
    ).toEqual([SETTINGS_FILE_NAME]);
  });

  it("does nothing for a workspace with no Topics folder", async () => {
    expect(await convertTopicsToTopicFiles(root)).toEqual({
      done: [],
      left: [],
    });
  });
});
