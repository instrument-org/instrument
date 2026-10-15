import { z } from "zod";

import { type SessionMessagePart } from "../../schemas/session/message-part";

/**
 * How a part of a transcript reads as one line of an outline, for the readers
 * that show what an agent did rather than what a call returned: a task's
 * steps (`steps.ts`) and the work folded into a chat's `CHAT.md`.
 */

/** How much of a step label a reader keeps. */
const LABEL_MAX_LENGTH = 120;

const PartMetadataSchema = z.object({ createdAt: z.date() });

const PartEndSchema = z.object({ endedAt: z.date() });

/** When the part was made, or nothing for one whose metadata does not say. */
export function partCreatedAt(part: SessionMessagePart.Type): Date | undefined {
  const metadata = PartMetadataSchema.safeParse(part.metadata);
  return metadata.success ? metadata.data.createdAt : undefined;
}

/**
 * When what the part holds came to an end: a call's output, a reply's last
 * word. Nothing for a part still going, and for one written before the field
 * existed.
 */
export function partEndedAt(part: SessionMessagePart.Type): Date | undefined {
  const metadata = PartEndSchema.safeParse(part.metadata);
  return metadata.success ? metadata.data.endedAt : undefined;
}

/** The fields of a call's input a label can be drawn from. */
const LabelInputSchema = z.object({
  activity: z.string().optional(),
  command: z.string().optional(),
  explanation: z.string().optional(),
  filePath: z.string().optional(),
  name: z.string().optional(),
  query: z.string().optional(),
  url: z.string().optional(),
});

/** The fields of a call's output that say how it ended. */
const OutcomeOutputSchema = z.object({
  exitCode: z.number().optional(),
  processId: z.string().optional(),
});

/** Text as one line, its own breaks closed up, cut at `maxLength`. */
export function clipLine(text: string, maxLength: number): string {
  const oneLine = text.replaceAll(/\s*\n\s*/g, " ");
  return oneLine.length > maxLength
    ? `${oneLine.slice(0, maxLength)}…`
    : oneLine;
}

/**
 * The phase of work the call named for itself, which a model may leave out.
 * A run of calls that name the same one belong to it together.
 */
export function callActivity(
  part: SessionMessagePart.ToolPart,
): string | undefined {
  const parsed = LabelInputSchema.safeParse(part.input);
  const named = parsed.success ? parsed.data.activity?.trim() : undefined;
  return named ? clipLine(named, LABEL_MAX_LENGTH) : undefined;
}

/**
 * A tool call as one line: the tool's name, the agent's own label for the
 * call, and how it ended. A `bash` call that outlived its window names the
 * process it became.
 */
export function toolCallLine(part: SessionMessagePart.ToolPart): string {
  const tool = part.type.slice("tool-".length);
  const parsed = LabelInputSchema.safeParse(part.input);
  const input = parsed.success ? parsed.data : {};
  const label =
    input.explanation?.trim() ||
    input.command ||
    input.filePath ||
    input.query ||
    input.url ||
    input.name ||
    tool;
  return `${tool}: ${clipLine(label, LABEL_MAX_LENGTH)}${outcome(part)}`;
}

function outcome(part: SessionMessagePart.ToolPart): string {
  switch (part.state) {
    // A call can wait in `input-available` behind a write ahead of it in the
    // queue; only `startedAt` says it began.
    case "input-available": {
      return part.metadata.startedAt !== undefined ? " (running)" : " (queued)";
    }
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
