import { describe, expect, it } from "vitest";

import { quitPrompt } from "./quit-prompt";

describe("quitPrompt", () => {
  it("asks nothing when quitting stops nothing", () => {
    expect(quitPrompt({ chatCount: 0, jobNames: [] })).toBeUndefined();
  });

  it("counts the chats at work", () => {
    expect([
      quitPrompt({ chatCount: 1, jobNames: [] }),
      quitPrompt({ chatCount: 2, jobNames: [] }),
    ]).toMatchInlineSnapshot(`
      [
        {
          "confirm": "Stop and Quit",
          "detail": "Quitting stops what it's working on.",
          "message": "Stop 1 chat and quit?",
        },
        {
          "confirm": "Stop and Quit",
          "detail": "Quitting stops what they're working on.",
          "message": "Stop 2 chats and quit?",
        },
      ]
    `);
  });

  it("names a job left running", () => {
    expect(
      quitPrompt({ chatCount: 0, jobNames: ["Serving the comparison page"] })
        ?.detail,
    ).toMatchInlineSnapshot(`
      "Quitting stops this command, which is still running:
      Serving the comparison page"
    `);
  });

  it("names the jobs after the chats", () => {
    expect(
      quitPrompt({
        chatCount: 1,
        jobNames: [
          "Serving the comparison page",
          "Checking Intercom's pricing every hour",
        ],
      })?.detail,
    ).toMatchInlineSnapshot(`
      "Quitting stops what it's working on.

      Quitting also stops these commands, which are still running:
      Serving the comparison page
      Checking Intercom's pricing every hour"
    `);
  });

  it("counts the jobs past the first five", () => {
    expect(
      quitPrompt({
        chatCount: 0,
        jobNames: ["One", "Two", "Three", "Four", "Five", "Six", "Seven"],
      })?.detail,
    ).toMatchInlineSnapshot(`
      "Quitting stops these commands, which are still running:
      One
      Two
      Three
      Four
      Five
      and 2 more"
    `);
  });
});
