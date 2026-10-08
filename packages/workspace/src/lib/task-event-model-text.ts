import ms from "ms";

import { MOUNT } from "../mount-points";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { asClause } from "./as-clause";
import { describeHoldings } from "./chat/describe-holdings";
import { describeLeftRunning } from "./chat/left-running";
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
    const outcome =
      event.status === "error"
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
    // The shape of its folder, as counts: enough to see a repository copied
    // in or a build left behind, without a listing the chat can make
    // for itself when it wants the names.
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
    const holds = event.holds
      ? `\n  Its folder ${MOUNT.tasks}/${event.taskId} holds${event.status === "overdue" ? " so far" : ""}: ${describeHoldings(event.holds)}.`
      : "";
    // Where a result that lives on a page is: the tab, by the id `tab show`
    // takes, since the task's transcript holds only its account of the page.
    const tabs =
      event.tabs && event.tabs.length > 0
        ? `\n  Its pages still open in the window: ${event.tabs.map((tab) => `${tab.url ?? "a blank page"} (tab ${tab.id}${tab.openedBy === "handed" ? ", handed to it" : ""})`).join(", ")}.`
        : "";
    const running =
      event.running && event.running.length > 0
        ? `\n  It left running in the background: ${event.running.map((process) => describeLeftRunning(process)).join(", ")}. Stop what the user does not need with \`${TASK_COMMAND.name} stop ${event.taskId} <bg id>\`, or all of it with \`${TASK_COMMAND.name} stop ${event.taskId} --all\`; a server they are using stays.`
        : "";
    return `- ${event.taskId} ("${event.title}") ${outcome}${cost}.${steps}${summary}${inFlight}${needs}${holds}${tabs}${running}`;
  });

  // What to do about a wake is the prompt's business (When a task finishes);
  // the note says only what happened and why the turn is running.
  const overdue = data.events.every((event) => event.status === "overdue");
  if (overdue) {
    const asked = data.events.find((event) => event.askedAfterMs !== undefined);
    if (asked?.askedAfterMs !== undefined && data.events.length === 1) {
      return systemNote`
        You asked to look at a task after ${ms(asked.askedAfterMs, { long: true })}, and it is still at work:
        ${lines.join("\n")}
        Nothing has gone wrong that anyone has said. Nobody typed anything; this note is why you are awake.
      `;
    }
    return systemNote`
      ${data.events.length === 1 ? "A task you created is taking a while:" : "Tasks you created are taking a while:"}
      ${lines.join("\n")}
      Nothing has gone wrong that anyone has said; this is the clock. Nobody typed anything; this note is why you are awake.
    `;
  }

  const waiting = data.events.every(
    (event) => event.needs && event.needs.length > 0,
  );
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
    Nobody typed anything; this note is why you are awake.
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
