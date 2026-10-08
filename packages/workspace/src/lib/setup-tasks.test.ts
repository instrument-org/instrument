import { describe, expect, it } from "vitest";

import { parseSetupTasks, setupTasksMessage } from "./setup-tasks";

const TASK = {
  detail: "Makes a calendar you can edit.",
  icon: "calendar",
  needsFile: false,
  prompt: "Plan two weeks of Instagram posts for our fall menu.",
};

describe("parseSetupTasks", () => {
  it.each([
    ["bare", JSON.stringify({ summary: "a bakery.", tasks: [TASK] })],
    [
      "fenced with words around",
      `Here you go:\n\`\`\`json\n${JSON.stringify({ summary: "a bakery", tasks: [TASK] })}\n\`\`\``,
    ],
    [
      "after thinking",
      `<think>{"no": 1}</think>${JSON.stringify({ summary: "a bakery", tasks: [TASK] })}`,
    ],
  ])("reads the object when %s", (_, text) => {
    expect(parseSetupTasks(text)).toEqual({
      summary: "a bakery",
      tasks: [TASK],
    });
  });

  it("keeps four, and gives an unknown icon the plain one", () => {
    const tasks = Array.from({ length: 6 }, () => ({
      ...TASK,
      icon: "rocket",
    }));
    const parsed = parseSetupTasks(JSON.stringify({ summary: "x", tasks }));
    expect(parsed?.tasks.map((task) => task.icon)).toMatchInlineSnapshot(`
      [
        "list",
        "list",
        "list",
        "list",
      ]
    `);
  });

  it.each([
    ["no object", "Sorry, I can't."],
    ["broken JSON", "{ summary: "],
    ["no tasks", JSON.stringify({ summary: "x", tasks: [] })],
  ])("gives nothing for %s", (_, text) => {
    expect(parseSetupTasks(text)).toBeUndefined();
  });
});

describe("setupTasksMessage", () => {
  it("says the kinds of work and their own words", () => {
    expect(
      setupTasksMessage({
        work: ["Running a business", "Marketing & social"],
        workOther: " I run a small bakery in Austin ",
      }),
    ).toMatchInlineSnapshot(`
      "What fills my week: Running a business, Marketing & social.
      In my own words: I run a small bakery in Austin"
    `);
  });
});
