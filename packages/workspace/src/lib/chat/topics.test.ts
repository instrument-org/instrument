import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { utcStamp } from "../utc-stamp";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  createTopic,
  listTopics,
  retireTopic,
  TOPIC_FILE_NAME,
  topicName,
  TopicNameError,
  topicsDir,
  updateTopic,
} from "./topics";

// Topics are files at the workspace root, so each test gets a root of its
// own, removed after it rather than left in the machine's temporary folder.
const roots: string[] = [];

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "topics-"));
  roots.push(root);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
    workspaceMachineDir: AbsolutePathSchema.parse(path.join(root, ".machine")),
  });
});

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { force: true, recursive: true })),
  );
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
  it("moves a topic behind the ones in use", async () => {
    const reddit = await createTopic({ name: "Reddit" });
    const home = await createTopic({ name: "Home" });

    await retireTopic(reddit.id);

    const listed = await listTopics();
    expect(listed.map((topic) => [topic.id, topic.retired])).toEqual([
      [home.id, undefined],
      [reddit.id, true],
    ]);
  });
});

describe("topic folders", () => {
  it("keeps the whole topic in one TOPIC.md, in a folder by name", async () => {
    const made = await createTopic({
      about: "What to buy and where",
      emoji: "🛒",
      name: "Shopping",
    });
    await updateTopic(made.id, {
      color: "amber",
      folders: [{ path: "/Users/someone/Deals" }],
      instructions: "I have the Prime card.",
    });

    expect(tree(topicsDir())).toMatchInlineSnapshot(`
      [
        "Shopping/TOPIC.md",
      ]
    `);
    expect(await topicFile("Shopping")).toMatchInlineSnapshot(`
      "---
      id: <id>
      emoji: 🛒
      color: amber
      about: What to buy and where
      created: <created>
      ---

      I have the Prime card.
      "
    `);
    expect(await listTopics()).toEqual([
      {
        ...made,
        color: "amber",
        folders: [{ path: "/Users/someone/Deals" }],
        instructions: "I have the Prime card.",
      },
    ]);
  });

  it("writes the created stamp as ISO 8601 in UTC, to the second", async () => {
    const made = await createTopic({ name: "Shopping" });

    const front = await topicFile("Shopping", { stamps: false });
    expect(front).toMatch(/^created: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
    expect(front).toContain(`created: ${utcStamp(made.created)}`);
    // What is in hand and what is on disk are the same topic, to the second.
    expect((await listTopics())[0]?.created).toEqual(made.created);
  });

  it("marks a retired topic, and says nothing of one in the menus", async () => {
    const made = await createTopic({ name: "Trips" });
    expect(await topicFile("Trips")).not.toContain("retired");

    await retireTopic(made.id);

    expect(await topicFile("Trips")).toContain("retired: true");
  });

  it("writes back a key it does not know, where it found it", async () => {
    const made = await createTopic({ emoji: "✈️", name: "Trips" });
    // Two keys another client wrote, which this build has never heard of.
    await fs.writeFile(
      path.join(topicsDir(), "Trips", TOPIC_FILE_NAME),
      `---\nid: ${made.id}\nemoji: ✈️\ncreated: ${utcStamp(made.created)}\nsortsAfter: Home\nseen:\n  - phone\n---\n`,
    );

    await updateTopic(made.id, { instructions: "Aisle seats." });

    expect(await topicFile("Trips")).toMatchInlineSnapshot(`
      "---
      id: <id>
      emoji: ✈️
      created: <created>
      sortsAfter: Home
      seen:
        - phone
      ---

      Aisle seats.
      "
    `);
    expect((await listTopics())[0]?.others).toEqual({
      seen: ["phone"],
      sortsAfter: "Home",
    });
  });

  it("renames the folder with the topic, and a folder renamed by hand renames the topic", async () => {
    const made = await createTopic({ name: "Trips" });
    await updateTopic(made.id, { instructions: "Aisle seats." });

    await updateTopic(made.id, { name: "Travel" });
    expect(tree(topicsDir())).toMatchInlineSnapshot(`
      [
        "Travel/TOPIC.md",
      ]
    `);

    await fs.rename(
      path.join(topicsDir(), "Travel"),
      path.join(topicsDir(), "Away"),
    );
    expect(await listTopics()).toEqual([
      { ...made, instructions: "Aisle seats.", name: "Away" },
    ]);
    // The name is the folder's, so nothing in the file says it.
    expect(await topicFile("Away")).not.toContain("Away");
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

  it.each([
    ["instructions", { instructions: "Window seats." }],
    ["folders", { folders: [{ path: os.tmpdir() }] }],
  ])(
    "refuses a name in use given %s, leaving that topic as it was",
    async (_case, given) => {
      const made = await createTopic({ name: "Trips" });
      await updateTopic(made.id, { instructions: "Aisle seats." });

      await expect(createTopic({ name: "trips", ...given })).rejects.toThrow(
        new TopicNameError("There is already a topic called “Trips”"),
      );
      expect(await listTopics()).toEqual([
        { ...made, instructions: "Aisle seats." },
      ]);
    },
  );
});

/**
 * A topic's file as it reads, with the two values no snapshot can hold still
 * stood in for: its id and the moment it was made.
 */
async function topicFile(
  name: string,
  { stamps = true }: { stamps?: boolean } = {},
): Promise<string> {
  const text = await fs.readFile(
    path.join(topicsDir(), name, TOPIC_FILE_NAME),
    "utf8",
  );
  return stamps
    ? text
        .replace(/^id: .+$/m, "id: <id>")
        .replace(/^created: .+$/m, "created: <created>")
    : text;
}

function tree(dir: string): string[] {
  return fsSync
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(dir, path.join(entry.parentPath, entry.name))
        .replaceAll(path.sep, "/"),
    )
    .sort();
}
