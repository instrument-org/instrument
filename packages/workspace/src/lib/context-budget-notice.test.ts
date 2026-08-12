import { describe, expect, it } from "vitest";

import { computeContextBudget } from "./context-budget";
import { contextBudgetNotice } from "./context-budget-notice";

const notice = (contextLength: number | undefined, occupied: number) =>
  contextBudgetNotice(computeContextBudget({ contextLength, occupied }));

describe("contextBudgetNotice", () => {
  it("says nothing for a model whose window we do not know", () => {
    // The BYOK default. A session on an unmeasurable model has to behave
    // exactly as it did before this feature existed.
    expect(notice(undefined, 5_000_000)).toBeUndefined();
  });

  it("says nothing while there is room", () => {
    expect(notice(200_000, 10_000)).toBeUndefined();
  });

  it("tells the agent to finish its step first when the window is filling", () => {
    expect(notice(200_000, 150_000)).toMatchInlineSnapshot(`
      "<context-budget>
      About 18,000 of 168,000 tokens of context remain for this task.

      There is still room to work, so finish what you are in the middle of rather than stopping to write notes. Your working directory (/task) is a real folder that outlives this conversation. Files you write there survive; the conversation itself does not.

      Write your handoff notes before the room runs out. Say what a future reader needs in order to pick this up cold: the goal in the user's own terms, the decisions taken and why, what is finished, what is left, and the paths that matter.
      </context-budget>"
    `);
  });

  it("tells the agent to stop and write notes once the window is spent", () => {
    expect(notice(200_000, 175_000)).toMatchInlineSnapshot(`
      "<context-budget>
      This task has used all 168,000 tokens of context available to it.

      Write your handoff notes now, before doing anything else. Your working directory (/task) is a real folder that outlives this conversation. Files you write there survive; the conversation itself does not.

      Say what a future reader needs in order to pick this up cold: the goal in the user's own terms, the decisions taken and why, what is finished, what is left, and the paths that matter.
      </context-budget>"
    `);
  });
});
