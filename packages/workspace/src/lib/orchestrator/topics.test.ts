import { describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import {
  createTopic,
  listTopics,
  retireTopic,
  topicByName,
  topicName,
  updateTopic,
} from "./topics";

vi.mock(import("../session-store-storage"));

// Task state is a real file under the mock workspace, so a task id reused
// across runs would read the last run's topics.
let counter = 0;
const freshTask = () =>
  createMockTaskConfig(
    TaskIdSchema.parse(`topics-${Date.now()}-${(counter += 1)}`),
  );

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
    const taskId = freshTask();

    const reddit = await createTopic(taskId, { emoji: "🦆", name: "# Reddit" });
    const home = await createTopic(taskId, { name: "Home" });

    expect(reddit.id).toMatch(/^top_/);
    expect(reddit.name).toBe("Reddit");
    expect(reddit.emoji).toBe("🦆");
    const listed = await listTopics(taskId);
    expect(listed.map((topic) => topic.id)).toEqual([reddit.id, home.id]);
    expect(await topicByName(taskId, "reddit")).toEqual(reddit);
  });
});

describe("updateTopic", () => {
  it("changes what was given and leaves the rest", async () => {
    const taskId = freshTask();
    const made = await createTopic(taskId, { emoji: "🦆", name: "Reddit" });

    await updateTopic(taskId, made.id, { color: "#ff0000", name: "Ducks" });

    expect(await listTopics(taskId)).toEqual([
      { ...made, color: "#ff0000", name: "Ducks" },
    ]);
  });
});

describe("retireTopic", () => {
  it("moves a topic behind the ones in use and out of the name lookup", async () => {
    const taskId = freshTask();
    const reddit = await createTopic(taskId, { name: "Reddit" });
    const home = await createTopic(taskId, { name: "Home" });

    await retireTopic(taskId, reddit.id);

    const listed = await listTopics(taskId);
    expect(listed.map((topic) => [topic.id, topic.retired])).toEqual([
      [home.id, undefined],
      [reddit.id, true],
    ]);
    expect(await topicByName(taskId, "reddit")).toBeUndefined();
  });
});
