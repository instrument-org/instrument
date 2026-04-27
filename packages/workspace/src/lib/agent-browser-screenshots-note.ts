import { APP_NAME } from "@instrument-org/shared";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { systemNote } from "./system-note";

const MAX_SCREENSHOTS = 24;

// Files written by capture-browser-screenshot live at
// `.state/agent-browser/<hash>.jpg`. The note shows just the `<hash>`
// token (no `.jpg`, no directory prefix) so the agent has a stable
// identifier per call and can reconstruct the full path from the prefix
// advertised in the header when it actually needs to read the file
// (e.g. to inspect the page visually instead of re-capturing). The
// header also tells the agent these are UI metadata and not deliverables
// to mention to the user.
const SCREENSHOT_FILENAME_PATTERN = /([0-9a-f]+)\.jpg$/;

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
    \`agent-browser\` capture metadata (one entry per call, deduped by content).

    The ${APP_NAME} UI renders these screenshots inline for the user. Do NOT
    mention, summarize, or narrate them in your reply (e.g. no "I captured a
    screenshot", "the screenshot shows…", etc.).

    You MAY silently read the underlying files when you need to inspect a prior
    page state instead of re-capturing: each \`<hash>\` resolves to
    \`.state/agent-browser/<hash>.jpg\`.

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
    obs.startScreenshot &&
    obs.endScreenshot.path === obs.startScreenshot.path
  ) {
    return `- ${verb} (no change)`;
  }
  if (!obs.endScreenshot) {
    // Completed but no end-screenshot and no error: capture itself failed
    // silently. Show the start hash if available so the agent can anchor on
    // the pre-command state if needed.
    if (obs.startScreenshot) {
      return `- ${verb} -> (no after) ${screenshotHash(obs.startScreenshot.path)}`;
    }
    return `- ${verb} -> (no screenshots)`;
  }
  return `- ${verb} -> ${screenshotHash(obs.endScreenshot.path)}`;
}

function isComplete(item: Observation): item is CompleteObservation {
  return (
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    item.kind === "agent-browser-command" && item.status === "complete"
  );
}

function screenshotHash(filePath: string): string {
  const match = SCREENSHOT_FILENAME_PATTERN.exec(filePath);
  if (match?.[1]) {
    return match[1];
  }
  // Fall back to the basename if the file doesn't follow the expected
  // naming pattern (e.g. someone changed the capture filename format).
  // The agent still needs to be able to resolve to a real file when it
  // wants to look at a prior page state, so we keep enough to do that;
  // we just don't echo the full directory prefix.
  return filePath.split("/").pop() ?? filePath;
}

function subcommandVerb(subcommand: string): string {
  const trimmed = subcommand.trim();
  if (!trimmed) {
    return "(empty)";
  }
  const firstSpace = trimmed.search(/\s/);
  return firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
}
