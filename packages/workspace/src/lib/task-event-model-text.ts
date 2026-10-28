import ms from "ms";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { asClause } from "./as-clause";
import { describeLeftRunning } from "./chat/left-running";
import { WINDOW_COMMAND } from "./shell-commands/window-command";
import { TASK_COMMAND } from "./shell-commands/task-command";
import { systemNote } from "./system-note";

/**
 * The note that wakes a chat: which of its tasks finished a turn,
 * what each cost, and where to read more. Points at the log rather than
 * inlining it, so a wake costs the same context whether the child wrote one
 * line or a thousand.
 */
export function taskEventModelNote(
  data: SessionMessageDataPart.TaskEventDataPart,
) {
  const lines = data.events.map((event) => {
    // What the `task` command takes for it.
    const id = event.handle ?? event.sessionId;
    const outcome =
      event.stoppedBy === "app"
        ? `did not finish: ${asClause(event.ended ?? "The app closed before it finished")}`
        : event.stoppedBy === "person"
          ? `was ${asClause(event.ended ?? "Stopped by the user")} and did not finish`
          : event.status === "error"
            ? `stopped with an error${event.ended ? `, "${event.ended}"` : ""}`
            : event.status === "overdue"
              ? "is still working"
              : event.needs && event.needs.length > 0
                ? "is waiting on you"
                : event.ended
                  ? `was ${asClause(event.ended)}`
                  : "finished a turn";
    // Cache reads are named beside the total because they are most of a long
    // task's tokens and cost a fraction of the rest; the bare total reads as
    // money spent at full price, and a task stopped for its bill was measured
    // on a number that overstated it tenfold.
    const cached =
      event.cachedTokens !== undefined &&
      event.tokens !== undefined &&
      event.tokens > 0
        ? `, ${Math.round((100 * event.cachedTokens) / event.tokens)}% of them cached reads`
        : "";
    const spent = [
      event.activeMs === undefined
        ? undefined
        : `${ms(Math.max(1000, event.activeMs), { long: true })} of work`,
      event.tokens === undefined
        ? undefined
        : `${formatTokens(event.tokens)} tokens so far${cached}`,
    ].filter((part) => part !== undefined);
    const cost = spent.length > 0 ? ` (${spent.join(", ")})` : "";
    // The turn's activities in order say where a task is going; its latest
    // step alone is the fallback for a turn that set none.
    const steps =
      event.steps && event.steps.length > 0
        ? ` Its steps this turn, latest last: ${event.steps.map((step) => `"${step}"`).join(", ")}.`
        : "";
    // An ending already says why there were no last words. A finished task's
    // words come as a block under the line, indented, since they are its
    // receipt: a few sentences and a files fence rather than a phrase.
    const summary = event.summary
      ? event.status === "overdue"
        ? steps
          ? ""
          : ` Its latest step: "${event.summary}"`
        : ` It said:\n${indent(event.summary, "      ")}`
      : event.ended || event.status === "overdue"
        ? ""
        : " It said nothing.";
    // What the step running now is doing, on its own line: the measure of a
    // step that may never end on its own, which its label does not give.
    const inFlight =
      event.status === "overdue" && event.inFlight
        ? `\n  Now: ${event.inFlight}.`
        : "";
    const needs =
      event.needs && event.needs.length > 0
        ? `\n  It cannot go on without:\n${event.needs.map((need) => `      ${need}`).join("\n")}`
        : "";
    // Where a result that lives on a page is: the tab, by the id `instrument window show`
    // takes, since the task's transcript holds only its account of the page.
    const tabs =
      event.tabs && event.tabs.length > 0
        ? `\n  Its pages still open in the window: ${event.tabs.map((tab) => `${tab.url ?? "a blank page"} (tab ${tab.id}${tab.openedBy === "handed" ? ", handed to it" : ""})`).join(", ")}.`
        : "";
    const background =
      event.running && event.running.length > 0
        ? event.running
            .map((process) => describeLeftRunning(process))
            .join(", ")
        : undefined;
    const running =
      background === undefined
        ? ""
        : event.stoppedBy === "app"
          ? `\n  The app's closing also ended what it had running in the background: ${background}. None of it is running now.`
          : `\n  It left running in the background: ${background}. Stop what the user does not need with \`${TASK_COMMAND.name} stop ${id} <bg id>\`, or all of it with \`${TASK_COMMAND.name} stop ${id} --all\`; a server they are using stays.`;
    // The user's stop is a decision, not a turn to pick up again; a task that
    // hit its step limit or lost its model to an error is one to resume.
    const leave =
      event.stoppedBy === "person"
        ? ` Leave it stopped unless they ask for it again.`
        : event.stoppedBy === undefined && event.resumable
          ? ` \`${TASK_COMMAND.name} send ${id}\` picks it up again.`
          : "";
    return `- ${id} ("${event.title}") ${outcome}${cost}.${leave}${steps}${summary}${inFlight}${needs}${tabs}${running}`;
  });

  // Each kind of wake closes with what to do about it, since the note is read
  // at the moment it applies and the prompt need not carry every case.
  const overdue = data.events.every((event) => event.status === "overdue");
  if (overdue) {
    return systemNote`
      ${data.events.length === 1 ? "A task you created is taking a while:" : "Tasks you created are taking a while:"}
      ${lines.join("\n")}
      Nothing has gone wrong that anyone has said; this is the clock. Nobody typed anything; this note is why you are awake. One that is lost, or whose step has run for minutes with no tool call, gets \`${TASK_COMMAND.name} send <id> --now\` to steer it or \`${TASK_COMMAND.name} stop <id>\`, since minutes there are the user's money. One on track needs no word: end this turn without writing anything, since the user already sees it working.
    `;
  }

  // Written as the app quit and read with the chat's next turn after
  // relaunch, which is why it starts none.
  if (data.events.every((event) => event.stoppedBy === "app")) {
    return systemNote`
      ${data.events.length === 1 ? "The app closed while a task you created was working:" : "The app closed while tasks you created were working:"}
      ${lines.join("\n")}
      The app has been opened again since, and nothing ran while it was closed.
    `;
  }

  // Written as the user stopped a task, and read with their next message,
  // which is why it starts none.
  if (data.events.every((event) => event.stoppedBy === "person")) {
    return systemNote`
      ${data.events.length === 1 ? "The user stopped a task you created:" : "The user stopped tasks you created:"}
      ${lines.join("\n")}
    `;
  }

  const waiting = data.events.every(
    (event) => event.needs && event.needs.length > 0,
  );
  const anyWaiting = data.events.some(
    (event) => event.needs && event.needs.length > 0,
  );
  const anyTabs = data.events.some(
    (event) => event.tabs && event.tabs.length > 0,
  );
  const relay = waiting
    ? ""
    : ` What it found or made is yours to pass on, as the answer, in the conversation as it stands now: a line or two on what it means for the user, with what it made in the files fence, or nothing when they have since moved on or said they do not want it.${anyTabs ? ` A result on a page is in the tab listed; \`${WINDOW_COMMAND.name} show <id>\` it when the user has something to do there.` : ""}`;
  const asks = anyWaiting
    ? ` Give one waiting on you what you can with \`${TASK_COMMAND.name} send\`, ask the user in one message for the rest, and send it their answer; weigh what it asks of them against what they asked for, and never send it back for a check the user did not ask for.`
    : "";
  return systemNote`
    ${
      waiting
        ? data.events.length === 1
          ? "A task you created is waiting on you:"
          : "Tasks you created are waiting on you:"
        : data.events.length === 1
          ? "A task you created has finished:"
          : "Tasks you created have finished:"
    }
    ${lines.join("\n")}
    Nobody typed anything; this note is why you are awake.${relay}${asks}
  `;
}

function formatTokens(tokens: number) {
  return tokens >= 1000
    ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}K`
    : String(tokens);
}

function indent(text: string, prefix: string) {
  return text
    .split("\n")
    .map((line) => (line === "" ? line : `${prefix}${line}`))
    .join("\n");
}
