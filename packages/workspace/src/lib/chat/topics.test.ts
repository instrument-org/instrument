import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  createTopic,
  listTopics,
  retireTopic,
  topicByName,
  topicName,
  TopicNameError,
  topicsDir,
  updateTopic,
} from "./topics";

// Topics are files at the workspace root, so each test gets a root of its own.
beforeEach(async () => {
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(
      path.join(await fs.mkdtemp(path.join(os.tmpdir(), "topics-")), "chats"),
    ),
    rootDir: WorkspaceDirSchema.parse(
      await fs.mkdtemp(path.join(os.tmpdir(), "topics-")),
    ),
  });
});

describe("topicName", () => {
  it.each([
    ["#Reddit", "Reddit"],
    ["  Pelican   News  ", "Pelican News"],
    ["a name that runs well past the limit", "a name that runs well pa"],
  ])("makes %j into %j", (raw, expected) => {
    expect(topicName(raw)).toBe(expected);
  });
});

describe("createTopic", () => {
  it("adds a topic with an id of its own, keeping the order", async () => {
    const reddit = await createTopic({ emoji: "🦆", name: "# Reddit" });
    const home = await createTopic({ name: "Home" });

    expect(reddit.id).toMatch(/^top_/);
    expect(reddit.name).toBe("Reddit");
    expect(reddit.emoji).toBe("🦆");
    const listed = await listTopics();
    expect(listed.map((topic) => topic.id)).toEqual([reddit.id, home.id]);
    expect(await topicByName("reddit")).toEqual(reddit);
  });
});

describe("updateTopic", () => {
  it("changes what was given and leaves the rest", async () => {
    const made = await createTopic({ emoji: "🦆", name: "Reddit" });

    await updateTopic(made.id, { color: "#ff0000", name: "Ducks" });

    expect(await listTopics()).toEqual([
      { ...made, color: "#ff0000", name: "Ducks" },
    ]);
  });
});

describe("retireTopic", () => {
  it("moves a topic behind the ones in use and out of the name lookup", async () => {
    const reddit = await createTopic({ name: "Reddit" });
    const home = await createTopic({ name: "Home" });

    await retireTopic(reddit.id);

    const listed = await listTopics();
    expect(listed.map((topic) => [topic.id, topic.retired])).toEqual([
      [home.id, undefined],
      [reddit.id, true],
    ]);
    expect(await topicByName("reddit")).toBeUndefined();
  });
});

describe("topic folders", () => {
  it("keeps settings as JSON and the instructions as Markdown, in a folder by name", async () => {
    const made = await createTopic({ emoji: "🛒", name: "Shopping" });
    await updateTopic(made.id, {
      folders: [{ path: "/Users/someone/Deals" }],
      instructions: "I have the Prime card.",
    });

    expect(tree(topicsDir())).toMatchInlineSnapshot(`
      [
        "Shopping/.instrument/settings.json",
        "Shopping/instructions.md",
      ]
    `);
    const settings = JSON.parse(
      await fs.readFile(
        path.join(topicsDir(), "Shopping", ".instrument", "settings.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect({ ...settings, createdAt: "<at>", id: "<id>" })
      .toMatchInlineSnapshot(`
        {
          "createdAt": "<at>",
          "emoji": "🛒",
          "folders": [
            {
              "path": "/Users/someone/Deals",
            },
          ],
          "id": "<id>",
        }
      `);
    expect(await listTopics()).toEqual([
      {
        ...made,
        folders: [{ path: "/Users/someone/Deals" }],
        instructions: "I have the Prime card.",
      },
    ]);
  });

  it("renames the folder with the topic, and a folder renamed by hand renames the topic", async () => {
    const made = await createTopic({ name: "Trips" });
    await updateTopic(made.id, { instructions: "Aisle seats." });

    await updateTopic(made.id, { name: "Travel" });
    expect(tree(topicsDir())).toMatchInlineSnapshot(`
      [
        "Travel/.instrument/settings.json",
        "Travel/instructions.md",
      ]
    `);

    await fs.rename(
      path.join(topicsDir(), "Travel"),
      path.join(topicsDir(), "Away"),
    );
    expect(await listTopics()).toEqual([
      { ...made, instructions: "Aisle seats.", name: "Away" },
    ]);
  });

  it.each([
    [
      "a name another topic has",
      "home",
      "There is already a topic called “Home”",
    ],
    [
      "a character no folder can hold",
      "Deals: big",
      "Topic name can't contain any of: < > : \" / \\ | ? *",
    ],
    ["a leading period", ".hidden", "Topic name can't start with a period"],
  ])("refuses %s", async (_case, name, message) => {
    await createTopic({ name: "Home" });
    const made = await createTopic({ name: "Trips" });

    await expect(updateTopic(made.id, { name })).rejects.toThrow(
      new TopicNameError(message),
    );
  });

  it("returns the topic already called that, and brings back a retired one", async () => {
    const made = await createTopic({ name: "Trips" });
    await updateTopic(made.id, { instructions: "Aisle seats." });

    const again = await createTopic({ name: "trips" });
    expect(again.id).toBe(made.id);
    await retireTopic(made.id);
    const revived = await createTopic({ emoji: "✈️", name: "Trips" });
    expect(revived).toEqual({
      ...made,
      emoji: "✈️",
      instructions: "Aisle seats.",
    });
    const [listed] = await listTopics();
    expect(listed?.retired).toBeUndefined();
  });
});

function tree(dir: string): string[] {
  return fsSync
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}
