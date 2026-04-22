import { type SessionMessagePart } from "../schemas/session/message-part";
import { systemNote } from "./system-note";

const MAX_SCREENSHOTS = 24;

// Files written by capture-browser-screenshot live at
// `<tool-results>/agent-browser-<hash>.png`. The note shows just the
// `-<hash>.png` suffix so the agent can reconstruct the full path by
// concatenating with the prefix advertised in the header. Keeping the
// `-` and `.png` makes each reference look like an actual filename
// fragment instead of a bare hash, which (a) reads better and (b)
// nudges the agent toward treating it as a file it can open.
const SCREENSHOT_FILENAME_PATTERN = /agent-browser(-[0-9a-f]+\.png)$/;

type CompleteObservation = Extract<
  Observation,
  { kind: "agent-browser-command"; status: "complete" }
>;
type Observation = SessionMessagePart.ToolPartContextItem;

export function agentBrowserScreenshotsNote(
  contextItems: readonly Observation[] | undefined,
): string | undefined {
  if (!contextItems || contextItems.length === 0) {
    return undefined;
  }

  // Skip pending items: at the time this note is built (when the tool
  // output is being serialized to the model) any still-pending observation
  // represents a leak.
  const observations = contextItems.filter(isComplete);
  if (observations.length === 0) {
    return undefined;
  }

  const recent = observations.slice(-MAX_SCREENSHOTS);
  const omitted = observations.length - recent.length;

  const lines: string[] = [];
  if (omitted > 0) {
    lines.push(`- ... ${omitted} earlier call(s) omitted`);
  }
  for (const obs of recent) {
    lines.push(formatObservation(obs));
  }

  return systemNote`
    agent-browser screenshots (PNG written after each call, one per call, deduped by content; full path is \`tool-results/agent-browser<suffix>\`):
    ${lines.join("\n")}
  `;
}

function formatObservation(obs: CompleteObservation): string {
  // Just the verb (first whitespace-delimited token). The full subcommand
  // is already visible to the agent in its own prior bash invocation, so
  // repeating the URL/selector here is pure token waste; the verb is
  // enough to anchor each row to the call that produced it.
  const verb = subcommandVerb(obs.subcommand);
  if (obs.error) {
    return `- ${verb} failed: ${obs.error}`;
  }
  if (
    obs.endScreenshot &&
    obs.endScreenshot.path === obs.startScreenshot.path
  ) {
    return `- ${verb} (no change)`;
  }
  if (!obs.endScreenshot) {
    // Completed but no end-screenshot and no error: capture itself failed
    // silently. Show the start suffix so the agent can still inspect the
    // pre-command state if needed.
    return `- ${verb} -> (no after) ${screenshotSuffix(obs.startScreenshot.path)}`;
  }
  return `- ${verb} -> ${screenshotSuffix(obs.endScreenshot.path)}`;
}

function isComplete(item: Observation): item is CompleteObservation {
  return (
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    item.kind === "agent-browser-command" && item.status === "complete"
  );
}

function screenshotSuffix(filePath: string): string {
  const match = SCREENSHOT_FILENAME_PATTERN.exec(filePath);
  // Fall back to the full path if the file doesn't follow the expected
  // naming pattern (e.g. someone changed the capture filename format).
  return match?.[1] ?? filePath;
}

function subcommandVerb(subcommand: string): string {
  const trimmed = subcommand.trim();
  if (!trimmed) {
    return "(empty)";
  }
  const firstSpace = trimmed.search(/\s/);
  return firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
}
