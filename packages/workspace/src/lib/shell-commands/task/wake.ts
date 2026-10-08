import ms from "ms";

import { isWorking } from "../../chat/activity";
import { askWake, cancelAskedWake } from "../../chat/wake";
import { getWorkspaceActorRef } from "../../workspace-actor-ref";
import { type SubcommandInput, subcommand } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { requireOwnChild } from "./children";
import { type TaskCommandContext } from "./context";

export const wakeSubcommand = subcommand<TaskCommandContext>({
  booleans: ["cancel"],
  flags: ["in"],
  positional: 1,
  run: runWake,
  usage: `  ${TASK_COMMAND.name} wake <id> --in <duration>|--cancel
      Be woken about a task after a delay you choose (30s, 5m, 1h), with where it
      stands then: its steps this turn, what it has written, what it has spent.
      For work you expect to take a known while, so you look when it matters
      rather than when the clock does; the clock's own note stays quiet for
      that task until then. Asking again moves the wake, --cancel forgets it,
      and a task that finishes first wakes you as usual. Your turn ends; the
      note starts a new one.
`,
});

/**
 * The longest a conversation may put off looking at a task. Past this the
 * clock is the better judge, since a task that has run for hours is one the
 * user has stopped watching.
 */
const MAX_ASKED_WAKE_MS = ms("2 hours");

/**
 * Schedules the note the conversation asked for about one of its tasks. A
 * timer rather than a wait: the turn ends, and the note starts another one
 * when the time comes, the same way a finish does.
 */
async function runWake(input: SubcommandInput, context: TaskCommandContext) {
  const task = await requireOwnChild(input.positional[0], context);
  if (input.has("cancel")) {
    return cancelAskedWake(task.id)
      ? `Forgot the wake you asked for about ${task.id}; the clock takes over again.\n`
      : `No wake was pending for ${task.id}.\n`;
  }
  const raw = input.value("in");
  const afterMs = raw === undefined ? undefined : parseDelay(raw);
  if (afterMs === undefined) {
    throw new Error(
      "wake: --in takes a delay such as 30s, 5m, or 1h (or --cancel).",
    );
  }
  if (afterMs > MAX_ASKED_WAKE_MS) {
    throw new Error(
      `wake: --in may be at most ${ms(MAX_ASKED_WAKE_MS, { long: true })}.`,
    );
  }
  if (!isWorking(task.id)) {
    return `${task.id} is not running, so there is nothing to wake you about; you are told when it next finishes a turn.\n`;
  }
  askWake({
    afterMs,
    chatId: context.chatId,
    taskId: task.id,
    workspaceRef: getWorkspaceActorRef(),
  });
  return `You will be woken about ${task.id} in ${ms(afterMs, { long: true })} if it is still working; sooner if it finishes. End your turn.\n`;
}

/**
 * A delay the way the conversation writes one: `30s`, `5m`, `1h`, `90 sec`,
 * `2 hours`, or bare seconds. Undefined for anything else, and for zero.
 */
export function parseDelay(raw: string): number | undefined {
  const match =
    /^(\d+(?:\.\d+)?)\s*([smh]|sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours)?$/i.exec(
      raw.trim(),
    );
  if (!match?.[1]) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const perUnit = unit.startsWith("h")
    ? 3_600_000
    : unit.startsWith("m")
      ? 60_000
      : 1000;
  const delay = amount * perUnit;
  return delay > 0 ? Math.round(delay) : undefined;
}
