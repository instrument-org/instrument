import { describe, expect, it } from "vitest";

import {
  STARTER_TASKS,
  starterTasks,
  TASK_COUNT,
  WORK_KINDS,
  workPhrase,
} from "./tasks-starters";

describe("starter tasks", () => {
  it.each(WORK_KINDS.map((kind) => [kind.id]))(
    "%s has its own tasks and a full set",
    (id) => {
      expect(STARTER_TASKS[id].length).toBeGreaterThan(0);
      expect(starterTasks([id])).toHaveLength(TASK_COUNT);
    },
  );

  it("draws the bakery's four for business and marketing", () => {
    expect(
      starterTasks(["business", "Marketing & social"]).map((task) => [
        task.prompt,
        task.needsFile === true,
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          "Find what three competitors charge for what I sell, and make me a comparison page.",
          false,
        ],
        [
          "Plan two weeks of social posts, with captions and photo ideas.",
          false,
        ],
        [
          "Turn a sales spreadsheet into a one-page summary of what sold best.",
          true,
        ],
        [
          "Draft a friendly email to customers about our holiday hours.",
          false,
        ],
      ]
    `);
  });

  it("falls back to general tasks with nothing picked", () => {
    expect(starterTasks([])).toHaveLength(TASK_COUNT);
    expect(starterTasks(["something unknown"])).toHaveLength(TASK_COUNT);
  });

  it.each([
    [[], undefined],
    [["business"], "running a business"],
    [["business", "marketing"], "running a business and marketing"],
    [["sales", "money", "travel"], "sales, budgets and travel"],
  ])("phrases %j as %j", (work, phrase) => {
    expect(workPhrase(work)).toBe(phrase);
  });
});
