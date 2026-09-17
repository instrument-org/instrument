import ms from "ms";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { asClause } from "./as-clause";
import { describeLeftRunning } from "./orchestrator/left-running";
import { TASK_COMMAND } from "./shell-commands/task-command";
import { systemNote } from "./system-note";

/**
 * The note that wakes an orchestrator: which of its tasks finished a turn,
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
    const files =
      event.files && event.files.length > 0
        ? `\n  It ${event.status === "overdue" ? "has written so far" : "wrote"}: ${event.files.join(", ")}`
        : event.status === "overdue"
          ? "\n  It has written nothing yet."
          : "";
    const running =
      event.running && event.running.length > 0
        ? `\n  It left running in the background: ${event.running.map((process) => describeLeftRunning(process)).join(", ")}. Stop what the user does not need with \`${TASK_COMMAND.name} kill ${event.taskId} <bg id>\`, or all of it with \`${TASK_COMMAND.name} kill ${event.taskId}\`; a server they are using stays.`
        : "";
    return `- ${event.taskId} ("${event.title}") ${outcome}${cost}.${steps}${summary}${files}${running}`;
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

  return systemNote`
    ${data.events.length === 1 ? "A task you created has finished:" : "Tasks you created have finished:"}
    ${lines.join("\n")}
    Nobody typed anything; this note is why you are awake.
  `;
}

function indent(text: string, prefix: string) {
  return text
    .split("\n")
    .map((line) => (line === "" ? line : `${prefix}${line}`))
    .join("\n");
}

function formatTokens(tokens: number) {
  return tokens >= 1000
    ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}K`
    : String(tokens);
}
