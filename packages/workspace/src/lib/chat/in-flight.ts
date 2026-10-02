import { sum } from "radashi";

import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type TaskId } from "../../schemas/task-id";
import { isToolPart } from "../is-tool-part";
import { latestMessages } from "./activity";

/**
 * Characters per token for the estimate of what a step has written. Rough on
 * purpose, and labeled `~` wherever it shows: the true count arrives only when
 * the step ends, which a step that never ends does not.
 */
const CHARS_PER_TOKEN = 4;

/**
 * The step a working task is in, as one line read from its latest transcript.
 * Undefined when the task has no turn to read.
 */
export async function stepInFlight(
  taskId: TaskId,
  now = new Date(),
): Promise<string | undefined> {
  return stepInFlightIn(await latestMessages(taskId), now);
}

/**
 * The step in flight at the end of a transcript, in one line: how long the
 * turn has run, when it last called a tool, and what it is doing this moment.
 *
 * A step is one model request, stored as one assistant message whose parts
 * are saved as they stream, so the transcript already says what the step is
 * doing: writing (a text or reasoning part growing, the request not finished),
 * running a tool (a call with no output yet), or neither, between steps. The
 * line is what a latest step's label does not say: a task that called a tool
 * five minutes ago and has been writing ever since reads the same by label as
 * one in the middle of that tool call.
 */
export function stepInFlightIn(
  messages: SessionMessage.WithParts[],
  now: Date,
): string | undefined {
  const turnStart = messages.findLastIndex(
    (message) => message.role === "user",
  );
  if (turnStart === -1) {
    return undefined;
  }
  const startedAt = messages[turnStart]?.metadata.createdAt;
  if (!startedAt) {
    return undefined;
  }
  const steps = messages
    .slice(turnStart + 1)
    .filter((message) => message.role === "assistant");
  const callTimes = steps
    .flatMap((message) => message.parts.filter(isToolPart))
    .map((part) => part.metadata.createdAt.getTime());
  const lastCallAt = callTimes.length > 0 ? Math.max(...callTimes) : undefined;
  const working = `working ${formatSpan(now.getTime() - startedAt.getTime())}`;
  const current = steps.at(-1);
  if (!current) {
    return `${working} · waiting on the model`;
  }

  // Read-only calls run together, so a step can have several running at once,
  // and calls queued behind them wait in the same state without a `startedAt`.
  const waiting = current.parts
    .filter(isToolPart)
    .filter((part) => part.state === "input-available");
  const started = waiting.filter((part) => part.metadata.startedAt);
  const running = started.length > 0 ? started : waiting.slice(-1);
  if (running.length > 0 && current.metadata.finishedAt) {
    const since = Math.min(
      ...running.map((part) =>
        (part.metadata.startedAt ?? part.metadata.createdAt).getTime(),
      ),
    );
    const [only] = running;
    const what =
      running.length === 1 && only
        ? toolName(only)
        : `${running.length} calls (${[...new Set(running.map(toolName))].join(", ")})`;
    return `${working} · running ${what} for ${formatSpan(now.getTime() - since)} (still running)`;
  }

  const lastCall =
    lastCallAt === undefined
      ? "no tool call this turn"
      : `last tool call ${formatSpan(now.getTime() - lastCallAt)} ago`;
  if (current.metadata.finishedAt) {
    return `${working} · ${lastCall} · between steps`;
  }

  // The request is still streaming: what it has written since its last call.
  const afterCall = current.parts.slice(
    current.parts.findLastIndex((part) => isToolPart(part)) + 1,
  );
  const streamingCall = current.parts
    .filter(isToolPart)
    .findLast((part) => part.state === "input-streaming");
  if (streamingCall) {
    return `${working} · ${lastCall} · writing a ${toolName(streamingCall)} call for ${formatSpan(now.getTime() - streamingCall.metadata.createdAt.getTime())}`;
  }
  const written = afterCall.filter(
    (part) => part.type === "text" || part.type === "reasoning",
  );
  const chars = sum(written, (part) => part.text.length);
  const since = written[0]?.metadata.createdAt ?? current.metadata.createdAt;
  const span = formatSpan(now.getTime() - since.getTime());
  if (chars === 0) {
    return `${working} · ${lastCall} · waiting on the model for ${span}`;
  }
  const verb = written.some((part) => part.type === "text" && part.text)
    ? "writing"
    : "thinking";
  return `${working} · ${lastCall} · ${verb} for ${span}: ~${formatTokens(Math.round(chars / CHARS_PER_TOKEN))} tokens, no tool call`;
}

/** A span as the line gives it: seconds, then minutes and seconds, then hours. */
function formatSpan(spanMs: number): string {
  const seconds = Math.max(0, Math.round(spanMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return minutes < 10 && rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatTokens(tokens: number): string {
  return tokens >= 1000
    ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}K`
    : String(tokens);
}

function toolName(part: SessionMessagePart.ToolPart): string {
  return part.type.slice("tool-".length);
}
