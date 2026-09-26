import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { WorkspaceDirSchema } from "../../schemas/paths";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  createTopic,
  listTopics,
  retireTopic,
  topicByName,
  topicName,
  topicsDir,
  updateTopic,
} from "./topics";

// Topics are files at the workspace root, so each test gets a root of its own.
beforeEach(async () => {
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
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

describe("topic files", () => {
  it("keeps the mark in front matter and the instructions as the body", async () => {
    const made = await createTopic({ emoji: "🛒", name: "Shopping: deals" });
    const file = path.join(topicsDir(), made.id, "topic.md");
    const written = await fs.readFile(file, "utf8");
    expect(written.replace(/created: .*/, "created: <at>"))
      .toMatchInlineSnapshot(`
        "---
        name: "Shopping: deals"
        emoji: "🛒"
        created: <at>
        ---
        "
      `);

    await fs.writeFile(file, `${written}I have the Prime card.\n`);
    const [read] = await listTopics();
    expect(read?.instructions).toBe("I have the Prime card.");
    expect(read?.name).toBe("Shopping: deals");
  });

  it("reads a hand-written file with no front matter as instructions", async () => {
    await fs.mkdir(path.join(topicsDir(), "top_handmade"), { recursive: true });
    await fs.writeFile(
      path.join(topicsDir(), "top_handmade", "topic.md"),
      "Only the words.\n",
    );
    const [read] = await listTopics();
    expect(read).toMatchObject({
      id: "top_handmade",
      instructions: "Only the words.",
    });
  });
});
