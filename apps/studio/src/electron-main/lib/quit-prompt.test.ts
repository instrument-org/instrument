import { describe, expect, it } from "vitest";

import { quitPrompt } from "./quit-prompt";

describe("quitPrompt", () => {
  it("asks nothing when quitting stops nothing", () => {
    expect(quitPrompt({ agentCount: 0, jobNames: [] })).toBeUndefined();
  });

  it("warns about agents at work", () => {
    expect(quitPrompt({ agentCount: 2, jobNames: [] })).toMatchInlineSnapshot(`
      {
        "detail": "Active tasks will be interrupted and you may lose in-progress work.",
        "message": "Quit Instrument?",
      }
    `);
  });

  it("names a job left running", () => {
    expect(
      quitPrompt({ agentCount: 0, jobNames: ["Serving the comparison page"] })
        ?.detail,
    ).toMatchInlineSnapshot(`
      "Quitting stops this command, which is still running:
      Serving the comparison page"
    `);
  });

  it("names the jobs after the agents", () => {
    expect(
      quitPrompt({
        agentCount: 1,
        jobNames: [
          "Serving the comparison page",
          "Checking Intercom's pricing every hour",
        ],
      })?.detail,
    ).toMatchInlineSnapshot(`
      "Active tasks will be interrupted and you may lose in-progress work.

      Quitting also stops these commands, which are still running:
      Serving the comparison page
      Checking Intercom's pricing every hour"
    `);
  });

  it("counts the jobs past the first five", () => {
    expect(
      quitPrompt({
        agentCount: 0,
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
