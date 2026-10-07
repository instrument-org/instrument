import { taskDir } from "../../task-dir-utils";
import { getTaskState, setTaskState } from "../../task-record";
import { type SubcommandInput, subcommand } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { requireOwnChild } from "./children";
import { type TaskCommandContext } from "./context";
import { resolveTabs, tabIdOf, tabsHeldElsewhere } from "./tab-choice";

export const tabSubcommand = subcommand<TaskCommandContext>({
  booleans: ["none"],
  flags: ["add", "remove"],
  repeatable: ["add", "remove"],
  run: runTab,
  usage: `  ${TASK_COMMAND.name} tab <id> [<tab id>...] [--add <tab id>]... [--remove <tab id>]... [--none]
      Change which tabs a task holds after the fact, by the ids the note on
      their message gives. Tab ids on their own replace the tabs it was
      handed; --add and --remove change one at a time; --none lets go of all
      of them. Letting go of a tab never closes it.
`,
});

/**
 * Changes which of the window's tabs a task holds after it has started.
 *
 * The tabs are the user's and outlive the task, so this points the task's
 * browser at them rather than creating anything. Named on their own they
 * replace the tabs it was handed, keeping any it opened itself; `--add` and
 * `--remove` change the set one tab at a time; `--none` lets go of every tab,
 * leaving the task to open one of its own the next time it needs a page.
 * Letting go of a tab never closes it.
 */
async function runTab(input: SubcommandInput, context: TaskCommandContext) {
  const task = await requireOwnChild(input.positional[0], context);
  const named = input.positional.slice(1);
  const adds = input.all("add");
  const removes = input.all("remove");
  const none = input.has("none");
  if (
    named.length === 0 &&
    adds.length === 0 &&
    removes.length === 0 &&
    !none
  ) {
    throw new Error(
      "tab: name the tabs to hand over, or --add, --remove, or --none. The note on the user's message lists the tabs open.",
    );
  }
  const state = await getTaskState(taskDir(task.id));
  const current = state.browserTabs;
  if (none) {
    if (current.length === 0) {
      return `${task.id} holds no tabs; it opens one of its own already.\n`;
    }
    await setTaskState(taskDir(task.id), { browserTabs: [] });
    return `${task.id} let go of every tab it held; they stay open. It opens a tab of its own from here.\n`;
  }
  const handed = await resolveTabs([...named, ...adds]);
  const letGo = await resolveTabs(removes, { closedIsFine: true });
  const dropped = new Set<string>(letGo);
  const kept =
    named.length > 0
      ? current.filter((held) => held.openedBy === "task")
      : current;
  const next = [
    ...kept.filter((held) => !dropped.has(held.id)),
    ...handed
      .filter((id) => !kept.some((held) => held.id === id))
      .map((id) => ({ id, openedBy: "handed" as const })),
  ];
  await setTaskState(taskDir(task.id), {
    browserTabs: next,
  });
  const shared = await tabsHeldElsewhere(handed, context.chatId, task.id);
  return `${task.id} now holds ${next.length > 0 ? `tabs ${next.map((held) => tabIdOf(held.id)).join(", ")}` : "no tabs"}. It acts on them from its next browser command.\n${shared}`;
}
