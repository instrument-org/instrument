import { taskDir } from "../../task-dir-utils";
import { getTaskSettings, updateTaskSettings } from "../../task-settings";
import {
  type SubcommandInput,
  type SubcommandShell,
  subcommand,
} from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { resolveApps } from "./app-choice";
import { requireOwnChild } from "./children";
import { type TaskCommandContext } from "./context";
import { grantPurpose, tellOfGrant } from "./delivery";

export const appSubcommand = subcommand<TaskCommandContext>({
  booleans: ["none"],
  flags: ["add", "remove"],
  positional: 1,
  repeatable: ["add", "remove"],
  run: runApp,
  usage: `  ${TASK_COMMAND.name} app <id> [--add <slug>]... [--remove <slug>]... [--none] [<<'EOF'
  <what it is for>
  EOF]
      Change which connected apps a task may reach; --none takes every one
      away. A task that stopped for want of a service is why this exists:
      connect the app with \`connect_app\` and hand it over here, with what it
      is for on stdin, and the task carries on rather than starting the work
      again from nothing. It is told the way \`folder\` tells it. Only a
      connected app can be handed over.
`,
});

/**
 * Changes which connected apps a task may reach.
 *
 * The flow this exists for: a task needs a service it was not handed, and it
 * has no way to ask for one itself, so it stops and says so. The conversation
 * connects the app with the user and hands it over here, and the task is told
 * in the same call and carries on. Without this the app arrives with nowhere
 * to go and the only move left is a second task, briefed from nothing, paying
 * again for everything the first one had worked out.
 */
async function runApp(
  input: SubcommandInput,
  context: TaskCommandContext,
  { stdin }: SubcommandShell,
) {
  const task = await requireOwnChild(input.positional[0], context);
  const askedAdds = input.all("add");
  const none = input.has("none");
  if (askedAdds.length === 0 && !input.has("remove") && !none) {
    throw new Error(
      `app: --add, --remove, or --none is required. \`${TASK_COMMAND.name} show ${task.id}\` lists the apps it has.`,
    );
  }
  const settings = await getTaskSettings(taskDir(task.id));
  // A task a person made reaches every app and holds no list; narrowing it to
  // one here would take away every app it has by handing it a single app.
  if (settings?.apps === undefined) {
    throw new Error(
      `${task.id} was not created by this conversation, so it already reaches every connected app.`,
    );
  }
  const askedRemoves = none ? settings.apps : input.all("remove");
  // Checked before anything is written, so a refused slug leaves the task's
  // apps as they were rather than half changed.
  const adds = await resolveApps(askedAdds);
  const held = new Set(settings.apps);
  for (const slug of askedRemoves) {
    if (!held.has(slug)) {
      throw new Error(
        `${task.id} does not have "${slug}". It has: ${settings.apps.join(", ") || "none"}.`,
      );
    }
  }
  const purpose = await grantPurpose("app", task.id, context, stdin);
  const removed = new Set(askedRemoves);
  const added = adds.filter((slug) => !held.has(slug));
  const apps = [
    ...settings.apps.filter((slug) => !removed.has(slug)),
    ...added,
  ];
  const result = await updateTaskSettings(task.id, { apps });
  if (result.isErr()) {
    throw result.error;
  }
  const lines = [
    ...askedRemoves.map((slug) => `Took ${slug} back from ${task.id}.`),
    ...added.map((slug) => `${task.id} can now reach ${slug}.`),
  ];
  const told = await tellOfGrant({
    added: added.length > 0,
    command: "app",
    context,
    facts: [
      ...added.map((slug) => `You were handed the connected app ${slug}.`),
      ...askedRemoves.map((slug) => `The app ${slug} was taken back from you.`),
    ],
    purpose,
    task,
  });
  return `${lines.join("\n") || (none ? `${task.id} had no apps.` : `${task.id} already had ${adds.join(", ")}.`)}\n${told}`;
}
