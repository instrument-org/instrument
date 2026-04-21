import { type SessionMessagePart } from "../schemas/session/message-part";
import { systemNote } from "./system-note";

const MAX_BROWSER_OBSERVATIONS = 16;

type BrowserScreenshot = Extract<
  ToolPartContextItem,
  { kind: "agent-browser-screenshot" }
>;
type ToolPartContextItem = SessionMessagePart.ToolPartContextItem;

export function browserObservationsNote(
  contextItems: readonly ToolPartContextItem[] | undefined,
): string | undefined {
  if (!contextItems || contextItems.length === 0) {
    return undefined;
  }

  const screenshots = contextItems.filter(isScreenshot);
  if (screenshots.length === 0) {
    return undefined;
  }

  // Keep only the most recent observations to bound token usage. We cap on
  // total screenshots (not URL groups) since each shot is what the agent may
  // actually want to read.
  const recent = screenshots.slice(-MAX_BROWSER_OBSERVATIONS);
  const omitted = screenshots.length - recent.length;

  // Group consecutive observations by URL so the URL prints once per run of
  // shots taken on that page, with nested relative paths underneath.
  const groups: { paths: string[]; url: string }[] = [];
  for (const item of recent) {
    const tail = groups.at(-1);
    if (tail && tail.url === item.url) {
      tail.paths.push(item.screenshotPath);
    } else {
      groups.push({ paths: [item.screenshotPath], url: item.url });
    }
  }

  const lines: string[] = [];
  if (omitted > 0) {
    lines.push(`- ... ${omitted} earlier screenshot(s) omitted`);
  }
  for (const { paths, url } of groups) {
    lines.push(`- ${url}`);
    for (const p of paths) {
      lines.push(`  - ${p}`);
    }
  }

  return systemNote`
    Auto-captured browser screenshots (shown to the user to reconstruct the session; you may also read these image files if useful). Grouped by URL:
    ${lines.join("\n")}
  `;
}

function isScreenshot(item: ToolPartContextItem): item is BrowserScreenshot {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return item.kind === "agent-browser-screenshot";
}
