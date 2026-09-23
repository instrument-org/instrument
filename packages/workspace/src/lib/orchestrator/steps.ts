import { z } from "zod";

import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { TOOL_NAMES } from "../../tools/name";
import { isToolPart } from "../is-tool-part";
import { Store } from "../store";
import { latestSessionId } from "./latest-session";

/**
 * One line of a task's transcript read as a sequence of steps: what its agent
 * set out to do, each call it made and how the call ended, what it and the user
 * said. Tool output is left out on purpose. The transcript's last lines are
 * whatever printed last, and a search that listed ten thousand paths reads as a
 * task lost in them; the steps say what the task was doing.
 */
export interface Step {
  at: Date;
  kind: "activity" | "call" | "said" | "user";
  text: string;
}

/** How much of a spoken line the outline keeps. */
const SAID_MAX_LENGTH = 200;

/** How much of a step label the outline keeps. */
const LABEL_MAX_LENGTH = 120;

/** The outline as text, one step per line, the time in the reader's zone. */
export function renderSteps(steps: Step[]): string {
  return steps
    .map((step) => {
      const time = step.at.toLocaleTimeString("en-US", { hour12: false });
      switch (step.kind) {
        case "activity": {
          return `${time}  ${step.text}`;
        }
        case "call": {
          return `${time}    ${step.text}`;
        }
        case "said": {
          return `${time}  said: ${step.text}`;
        }
        case "user": {
          return `${time}  user: ${step.text}`;
        }
      }
    })
    .join("\n");
}

export async function sessionSteps({
  sessionId,
  taskId,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
}): Promise<Step[]> {
  const messages = await Store.getMessagesWithParts({ sessionId, taskId });
  if (messages.isErr()) {
    return [];
  }
  const steps: Step[] = [];
  for (const message of messages.value) {
    if (message.role === "user") {
      const text = message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim();
      if (text) {
        steps.push({
          at: message.metadata.createdAt,
          kind: "user",
          text: clip(text, SAID_MAX_LENGTH),
        });
      }
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of message.parts) {
      if (part.type === "text") {
        const text = part.text.trim();
        if (text) {
          steps.push({
            at: partCreatedAt(part) ?? message.metadata.createdAt,
            kind: "said",
            text: clip(text, SAID_MAX_LENGTH),
          });
        }
        continue;
      }
      if (!isToolPart(part)) {
        continue;
      }
      const step = toolStep(part, message.metadata.createdAt);
      if (step) {
        steps.push(step);
      }
    }
  }
  return steps;
}

/**
 * Where a task's agent has gone since a moment, oldest first, from its newest
 * session: the activities it set, or each call it made when it set none, since
 * `start_activity` sits behind a flag. What an overdue note carries in place of
 * the one latest step, so the conversation reads a trajectory rather than a
 * snapshot.
 */
export async function trajectorySince(
  taskId: TaskId,
  since: Date,
): Promise<string[]> {
  const sessionId = await latestSessionId(taskId);
  if (sessionId.isErr() || !sessionId.value) {
    return [];
  }
  const allSteps = await sessionSteps({ sessionId: sessionId.value, taskId });
  const steps = allSteps.filter((step) => step.at >= since);
  const activities = steps.filter((step) => step.kind === "activity");
  return (
    activities.length > 0
      ? activities
      : steps.filter((step) => step.kind === "call")
  ).map((step) => step.text);
}

function clip(text: string, maxLength: number): string {
  const oneLine = text.replaceAll(/\s*\n\s*/g, " ");
  return oneLine.length > maxLength
    ? `${oneLine.slice(0, maxLength)}…`
    : oneLine;
}

/** The fields of a call's input the outline can label it by. */
const LabelInputSchema = z.object({
  command: z.string().optional(),
  explanation: z.string().optional(),
  filePath: z.string().optional(),
  name: z.string().optional(),
  query: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
});

/** The fields of a call's output that say how it ended. */
const OutcomeOutputSchema = z.object({
  exitCode: z.number().optional(),
  processId: z.string().optional(),
});

const PartMetadataSchema = z.object({ createdAt: z.date() });

function outcome(part: SessionMessagePart.ToolPart): string {
  switch (part.state) {
    case "input-available":
    case "input-streaming": {
      return " (running)";
    }
    case "output-available": {
      const output = OutcomeOutputSchema.safeParse(part.output);
      if (!output.success) {
        return "";
      }
      if (output.data.processId !== undefined) {
        return ` (still running as ${output.data.processId})`;
      }
      return output.data.exitCode !== undefined && output.data.exitCode !== 0
        ? ` (exit ${output.data.exitCode})`
        : "";
    }
    case "output-error": {
      return " (failed)";
    }
    default: {
      return "";
    }
  }
}

function partCreatedAt(part: SessionMessagePart.Type): Date | undefined {
  const metadata = PartMetadataSchema.safeParse(part.metadata);
  return metadata.success ? metadata.data.createdAt : undefined;
}

/**
 * A tool call as one line: the activity's title for `start_activity`, and for
 * everything else the tool's name, the agent's own label for the call, and how
 * it ended. A `bash` call that outlived its window names the process it became.
 */
function toolStep(
  part: SessionMessagePart.ToolPart,
  fallbackAt: Date,
): Step | undefined {
  const at = partCreatedAt(part) ?? fallbackAt;
  const tool = part.type.slice("tool-".length);
  const parsed = LabelInputSchema.safeParse(part.input);
  const input = parsed.success ? parsed.data : {};

  if (tool === TOOL_NAMES.startActivity) {
    return input.title?.trim()
      ? { at, kind: "activity", text: clip(input.title, LABEL_MAX_LENGTH) }
      : undefined;
  }

  const label =
    input.explanation?.trim() ||
    input.command ||
    input.filePath ||
    input.query ||
    input.url ||
    input.name ||
    tool;
  return {
    at,
    kind: "call",
    text: `${tool}: ${clip(label, LABEL_MAX_LENGTH)}${outcome(part)}`,
  };
}
