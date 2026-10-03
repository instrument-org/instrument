import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";

import { parseAgentBrowserArgs } from "./agent-browser-args";

/**
 * The page snapshot a bash call ends with when its agent-browser commands left
 * the page changed and nothing after them read it.
 *
 * Measured on real task history, a model step that only ran `snapshot` followed
 * half of all clicks and two in five navigations, each a full model round trip
 * spent asking what the previous command did. Attaching the answer saves that
 * step. The cost lands on the other half, a click followed by another click or
 * by a read, so the snapshot is `snapshot -i --delta`: the whole page after a
 * navigation, and after an action on the same page only what changed in it,
 * which is a line when nothing did. The delta baseline is the CLI's own, kept
 * per tab and reset by a URL change, and refs survive across snapshots of one
 * document, so a ref from the earlier snapshot still names the same element.
 */
export const PageAfterSchema = z.object({
  /** The subcommand that changed the page, which the note names. */
  after: z.string(),
  kind: z.enum(["delta", "full", "unchanged"]),
  /** Lines of a full snapshot left out to keep the attachment bounded. */
  omittedLines: z.number().int().optional(),
  text: z.string(),
});

export type PageAfter = z.output<typeof PageAfterSchema>;

/** The snapshot a follow-up takes, matching what the note tells the model. */
export const FOLLOW_UP_SNAPSHOT_ARGS = ["snapshot", "-i", "--delta"];

/**
 * Characters of a full snapshot attached before the rest is cut. About the
 * 75th percentile of the `snapshot -i` outputs in real task history: a page
 * with more controls than that gets its head and a note saying how to see the
 * rest, rather than every later step carrying the whole of it.
 */
const FULL_SNAPSHOT_CHAR_BUDGET = 10_000;

/** How long the follow-up snapshot may take before the call returns without it. */
const FOLLOW_UP_TIMEOUT_MS = 10_000;

const NAVIGATIONS = new Set([
  "back",
  "forward",
  "goto",
  "navigate",
  "open",
  "pushstate",
  "reload",
]);
const ACTIONS = new Set([
  "check",
  "click",
  "dblclick",
  "key",
  "press",
  "select",
  "tap",
  "uncheck",
]);
/** Semantic locators, which act on what they find when given an action. */
const LOCATORS = new Set(["find", "first", "last", "nth"]);
/** Commands that put the page in front of the model themselves. */
const READS = new Set([
  "diff",
  "eval",
  "pdf",
  "read",
  "screenshot",
  "snapshot",
]);
/** `get` reads that say nothing about the page's controls. */
const METADATA_GETS = new Set([
  "box",
  "cdp-url",
  "count",
  "styles",
  "title",
  "url",
]);

/**
 * What one agent-browser invocation does to the model's picture of the page.
 *
 * `changes` covers navigation and the actions that commonly rearrange a page.
 * Typing into a field, hovering, scrolling and waiting are left out: they
 * rarely change which controls exist, and the action that follows them usually
 * does. `reads` is anything that shows the model the page, after which a
 * snapshot would repeat what it is reading. `get url` and `get title` are not
 * reads of that kind: a model checks them after a click and then snapshots.
 */
export function pageEffect(args: string[]): "changes" | "none" | "reads" {
  const { subArgs, subcommand } = parseAgentBrowserArgs(args);
  if (subcommand === undefined) {
    return "none";
  }
  const rest = subArgs.slice(1).map(({ value }) => value);
  if (NAVIGATIONS.has(subcommand) || ACTIONS.has(subcommand)) {
    return "changes";
  }
  if (subcommand === "tab") {
    return rest.length === 0 || rest[0] === "list" ? "none" : "changes";
  }
  if (subcommand === "dialog") {
    return rest[0] === "accept" || rest[0] === "dismiss" ? "changes" : "none";
  }
  if (LOCATORS.has(subcommand)) {
    return rest.some((arg) => ACTIONS.has(arg)) ? "changes" : "none";
  }
  if (subcommand === "get") {
    return rest[0] !== undefined && METADATA_GETS.has(rest[0])
      ? "none"
      : "reads";
  }
  return READS.has(subcommand) ? "reads" : "none";
}

/**
 * One bash call's record of whether the page still needs showing. Each
 * successful command that changes the page replaces what is pending with a way
 * to snapshot it; each read clears it; everything else leaves it alone, so the
 * last change wins and a chain ending in a read attaches nothing.
 */
export class BrowserFollowUp {
  #pending:
    | {
        after: string;
        snapshot: (signal: AbortSignal) => Promise<string | undefined>;
      }
    | undefined;

  note({
    args,
    exitCode,
    snapshot,
  }: {
    args: string[];
    exitCode: number;
    snapshot: (signal: AbortSignal) => Promise<string | undefined>;
  }) {
    const effect = pageEffect(args);
    if (effect === "reads") {
      this.#pending = undefined;
    } else if (effect === "changes" && exitCode === 0) {
      const { subcommand = "" } = parseAgentBrowserArgs(args);
      this.#pending = { after: subcommand, snapshot };
    }
  }

  /** Snapshot the page if it is still pending, once. */
  async take(signal: AbortSignal): Promise<PageAfter | undefined> {
    const pending = this.#pending;
    this.#pending = undefined;
    if (!pending) {
      return undefined;
    }
    try {
      const output = await pending.snapshot(
        AbortSignal.any([signal, AbortSignal.timeout(FOLLOW_UP_TIMEOUT_MS)]),
      );
      return output === undefined
        ? undefined
        : parseFollowUpSnapshot(output, pending.after);
    } catch {
      // The command the model ran already succeeded; a snapshot that could not
      // be taken leaves it to take one itself, as it would have anyway.
      return undefined;
    }
  }
}

const storage = new AsyncLocalStorage<BrowserFollowUp>();

/**
 * Run a bash call with a follow-up its agent-browser commands report to.
 * Async-context-scoped, like the output sink, so the command finds it on
 * whichever thread the interpreter calls it from.
 */
export function withBrowserFollowUp<T>(
  followUp: BrowserFollowUp,
  run: () => Promise<T>,
): Promise<T> {
  return storage.run(followUp, run);
}

export function currentBrowserFollowUp(): BrowserFollowUp | undefined {
  return storage.getStore();
}

const BOUNDARY_START = /^--- AGENT_BROWSER_PAGE_CONTENT nonce=\S+.* ---$/;
const BOUNDARY_END = /^--- END_AGENT_BROWSER_PAGE_CONTENT nonce=\S+ ---$/;
const UNCHANGED = /^unchanged \(revision \d+\)$/;

const DeltaSchema = z.object({
  changes: z.array(z.object({ op: z.string(), ref: z.string() })),
  kind: z.literal("delta"),
  treeChange: z.object({ lines: z.array(z.string()) }),
});

/**
 * Read what `snapshot -i --delta` printed into the shape the note renders.
 *
 * A delta arrives as the CLI's JSON, which restates every added element twice
 * (once as a ref operation, once as a tree line). Only the tree lines and the
 * removed refs are kept, inside the page-content markers the CLI drew, since
 * element names are the page's text. Anything that does not parse as the shape
 * expected is passed on whole rather than dropped.
 */
export function parseFollowUpSnapshot(
  output: string,
  after: string,
): PageAfter | undefined {
  const lines = output.trimEnd().split("\n");
  const first = lines[0];
  const last = lines.at(-1);
  if (first === undefined || first.trim() === "") {
    return undefined;
  }
  if (UNCHANGED.test(first.trim())) {
    return { after, kind: "unchanged", text: "" };
  }
  if (
    lines.length < 2 ||
    last === undefined ||
    !BOUNDARY_START.test(first) ||
    !BOUNDARY_END.test(last)
  ) {
    return { after, kind: "full", text: output.trimEnd() };
  }
  const body = lines.slice(1, -1);
  if (body[0]?.trimStart().startsWith("{")) {
    const delta = parseDelta(body.join("\n"));
    if (delta) {
      const removed = delta.changes
        .filter(({ op }) => op === "remove")
        .map(({ ref }) => ref);
      return {
        after,
        kind: "delta",
        text: [
          ...(delta.treeChange.lines.length > 0
            ? [first, ...delta.treeChange.lines, last]
            : []),
          ...(removed.length > 0
            ? [`No longer on the page: ${removed.join(", ")}`]
            : []),
        ].join("\n"),
      };
    }
  }
  const kept: string[] = [];
  let used = 0;
  for (const line of body) {
    if (used + line.length + 1 > FULL_SNAPSHOT_CHAR_BUDGET) {
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }
  const omittedLines = body.length - kept.length;
  return {
    after,
    kind: "full",
    ...(omittedLines > 0 ? { omittedLines } : {}),
    text: [first, ...kept, last].join("\n"),
  };
}

function parseDelta(text: string) {
  try {
    const parsed = DeltaSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The attachment as the model reads it: what it is, that it replaces the
 * snapshot the model would otherwise take next, and the page.
 */
export function pageAfterText(page: PageAfter): string {
  const source = `\`agent-browser ${FOLLOW_UP_SNAPSHOT_ARGS.join(" ")}\``;
  switch (page.kind) {
    case "unchanged": {
      return `Page after \`${page.after}\` (${source}, run for you): no interactive element changed since the page's last snapshot. Text outside the controls is not compared; read it with \`get text\` if the action should have changed it.`;
    }
    case "delta": {
      return [
        `Page after \`${page.after}\` (${source}, run for you): only what changed since the page's last snapshot is below, and every other element and ref is as it was. If you no longer have that snapshot, run \`agent-browser snapshot -i\`.`,
        page.text ||
          "Its structure changed, but no element was added or removed.",
      ].join("\n");
    }
    case "full": {
      const omitted =
        page.omittedLines === undefined
          ? ""
          : `\n${page.omittedLines} more lines are not shown. Run \`agent-browser snapshot -i\` for all of them, or add \`-s <selector>\` for one region.`;
      return [
        `Page after \`${page.after}\` (${source}, run for you). Act on these refs directly instead of taking another snapshot; run one only for what this leaves out (\`snapshot -i --urls\` for link addresses).`,
        page.text + omitted,
      ].join("\n");
    }
  }
}
