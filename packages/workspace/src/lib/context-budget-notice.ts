import { MOUNT } from "../mount-points";
import { type ContextBudget } from "./context-budget";

/**
 * What the agent is told when its context window is running out.
 *
 * The notice is derived from the current budget on every request and is never
 * persisted, so it corrects itself as the numbers move and leaves no trace in
 * the transcript. It is also appended after the cache breakpoints rather than
 * folded into the prompt, so a number that changes every turn cannot invalidate
 * the cached prefix.
 *
 * The task folder is the answer to "durable where?": it is the agent's working
 * directory, it is a real directory on disk, and it outlives any single context
 * window. Notes written there are readable by whatever continues the task,
 * which is what makes warning the agent worth doing at all.
 */
export function contextBudgetNotice(budget: ContextBudget): string | undefined {
  if (budget.status === "ok" || budget.status === "unknown") {
    return undefined;
  }

  const preserve = `Your working directory (${MOUNT.task}) is a real folder that outlives this conversation. Files you write there survive; the conversation itself does not.`;
  const record =
    "Say what a future reader needs in order to pick this up cold: the goal in the user's own terms, the decisions taken and why, what is finished, what is left, and the paths that matter.";

  if (budget.status === "exhausted") {
    return [
      "<context-budget>",
      `This task has used all ${budget.usable.toLocaleString("en-US")} tokens of context available to it.`,
      "",
      `Write your handoff notes now, before doing anything else. ${preserve}`,
      "",
      record,
      "</context-budget>",
    ].join("\n");
  }

  return [
    "<context-budget>",
    `About ${budget.remaining.toLocaleString("en-US")} of ${budget.usable.toLocaleString("en-US")} tokens of context remain for this task.`,
    "",
    `There is still room to work, so finish what you are in the middle of rather than stopping to write notes. ${preserve}`,
    "",
    `Write your handoff notes before the room runs out. ${record}`,
    "</context-budget>",
  ].join("\n");
}
