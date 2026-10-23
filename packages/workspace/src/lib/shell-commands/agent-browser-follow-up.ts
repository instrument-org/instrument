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
  /**
   * A delta whose changed region was too long to show, given instead as the
   * controls that came, went or were renamed.
   */
  summarized: z.boolean().optional(),
  /**
   * What the page itself says went wrong or went through, from the element it
   * marked as its message. A control renaming itself is all the snapshot
   * shows of a refused sign-in; this is the sentence beside it.
   */
  said: z.string().optional(),
  text: z.string(),
  /** The page this is of, which the snapshot's own lines never name. */
  title: z.string().optional(),
  url: z.string().optional(),
});

export type PageAfter = z.output<typeof PageAfterSchema>;

/** The snapshot a follow-up takes, matching what the note tells the model. */
export const FOLLOW_UP_SNAPSHOT_ARGS = ["snapshot", "-i", "--delta"];

/** Run ahead of the snapshot, so a navigation the change started has a DOM. */
export const FOLLOW_UP_WAIT_ARGS = ["wait", "--load", "domcontentloaded"];

/** Names the page the snapshot is of: its own lines never do. */
export const FOLLOW_UP_TABS_ARGS = ["tab", "list", "--json"];

/**
 * The page's own message about what just happened, from the element it marked
 * as one. A refused sign-in renames its button and says why beside it, and
 * the interactive snapshot carries the renamed button alone. Exits non-zero
 * on a page with no such element, which is most pages, so a failure here is
 * an answer and not an error.
 */
export const FOLLOW_UP_SAID_ARGS = ["find", "role", "alert", "text"];

/** How much of the page's own message is carried; it is a sentence, not a page. */
const SAID_CHAR_BUDGET = 400;

/** What `snapshot -i` prints for a page with no controls in it. */
const NO_CONTROLS = "(no interactive elements)";

/**
 * Characters of a full snapshot attached before the rest is cut. About the
 * 75th percentile of the `snapshot -i` outputs in real task history: a page
 * with more controls than that gets its head and a note saying how to see the
 * rest, rather than every later step carrying the whole of it.
 */
const FULL_SNAPSHOT_CHAR_BUDGET = 10_000;

/**
 * Characters of a delta's changed region shown as the page's own lines. The
 * CLI's delta is the span from the first changed line to the last, so a
 * change near the top and another near the bottom carry the whole page
 * between them: on real task history a click's delta averaged as long as a
 * full snapshot. Past this the delta is told as the controls it changed.
 */
const DELTA_CHAR_BUDGET = 2000;

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
/** What one follow-up read of the page came back with. */
export interface PageRead {
  /** The page's own message, where it marked one. */
  said?: string;
  snapshot: string;
  title?: string;
  url?: string;
}

export class BrowserFollowUp {
  #pending:
    | {
        after: string;
        read: (signal: AbortSignal) => Promise<PageRead | undefined>;
      }
    | undefined;

  note({
    args,
    exitCode,
    read,
  }: {
    args: string[];
    exitCode: number;
    read: (signal: AbortSignal) => Promise<PageRead | undefined>;
  }) {
    const effect = pageEffect(args);
    if (effect === "reads") {
      this.#pending = undefined;
    } else if (effect === "changes" && exitCode === 0) {
      const { subcommand = "" } = parseAgentBrowserArgs(args);
      this.#pending = { after: subcommand, read };
    }
  }

  #screenshot: string | undefined;

  /**
   * A screenshot one of the call's commands wrote, by where it is on the
   * host. The last one wins: a call that takes several is shown the newest,
   * which keeps what one call adds to the context to a single image.
   */
  noteScreenshot(hostPath: string) {
    this.#screenshot = hostPath;
  }

  /** The screenshot to show the model, once. */
  takeScreenshot(): string | undefined {
    const screenshot = this.#screenshot;
    this.#screenshot = undefined;
    return screenshot;
  }

  /** Read the page if it is still pending, once. */
  async take(signal: AbortSignal): Promise<PageAfter | undefined> {
    const pending = this.#pending;
    this.#pending = undefined;
    if (!pending) {
      return undefined;
    }
    try {
      const page = await pending.read(
        AbortSignal.any([signal, AbortSignal.timeout(FOLLOW_UP_TIMEOUT_MS)]),
      );
      if (page === undefined) {
        return undefined;
      }
      const parsed = parseFollowUpSnapshot(page.snapshot, pending.after);
      return parsed === undefined
        ? undefined
        : {
            ...parsed,
            ...(page.said === undefined
              ? {}
              : { said: clip(page.said, SAID_CHAR_BUDGET) }),
            ...(page.title === undefined ? {} : { title: page.title }),
            ...(page.url === undefined ? {} : { url: page.url }),
          };
    } catch {
      // The command the model ran already succeeded; a page that could not be
      // read leaves it to read one itself, as it would have anyway.
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

const UNCHANGED = /^unchanged \(revision \d+\)$/;

// The CLI's own line for a screenshot it wrote (`--if-changed` prints another
// for one it skipped), colored only on a terminal, which this never is.
const SCREENSHOT_SAVED = /Screenshot saved to (.+)$/m;

/** Where a `screenshot` command's output says it wrote the image. */
export function savedScreenshotPath(stdout: string): string | undefined {
  return SCREENSHOT_SAVED.exec(stdout)?.[1]?.trim() || undefined;
}

const DeltaSchema = z.object({
  changes: z.array(
    z.object({
      field: z.string().optional(),
      node: z.object({ name: z.string(), role: z.string() }).optional(),
      op: z.string(),
      ref: z.string(),
      value: z.unknown().optional(),
    }),
  ),
  kind: z.literal("delta"),
  treeChange: z.object({ lines: z.array(z.string()) }),
});

/**
 * Read what `snapshot -i --delta` printed into the shape the note renders.
 *
 * A delta arrives as the CLI's JSON, which restates every added element twice
 * (once as a ref operation, once as a tree line). Only the tree lines and the
 * removed refs are kept, the removed refs first, since they are ours to state
 * and the element names in the tree lines are the page's text. Anything that
 * does not parse as a delta is read as a full snapshot rather than dropped.
 */
export function parseFollowUpSnapshot(
  output: string,
  after: string,
): PageAfter | undefined {
  const body = output.trimEnd().split("\n");
  const first = body[0];
  if (first === undefined || first.trim() === "") {
    return undefined;
  }
  if (UNCHANGED.test(first.trim())) {
    return { after, kind: "unchanged", text: "" };
  }
  // Most often a page caught before it loaded. Shown as the page after the
  // change, it reads as a dead end; left out, the model looks for itself.
  if (body.length === 1 && body[0]?.trim() === NO_CONTROLS) {
    return undefined;
  }
  if (body[0]?.trimStart().startsWith("{")) {
    const delta = parseDelta(body.join("\n"));
    if (delta) {
      const removed = delta.changes
        .filter(({ op }) => op === "remove")
        .map(({ ref }) => ref);
      const gone =
        removed.length > 0
          ? [`No longer on the page: ${removed.join(", ")}`]
          : [];
      if (delta.treeChange.lines.join("\n").length <= DELTA_CHAR_BUDGET) {
        return {
          after,
          kind: "delta",
          text: [...gone, ...delta.treeChange.lines].join("\n"),
        };
      }
      const changed = delta.changes.flatMap(
        ({ field, node, op, ref, value }) =>
          op === "add" && node
            ? [
                `- ${node.role} ${JSON.stringify(node.name)} [ref=${ref.slice(1)}]`,
              ]
            : op === "replace" && typeof value === "string"
              ? [`- ${ref} ${field ?? "name"} is now ${JSON.stringify(value)}`]
              : [],
      );
      const kept = withinBudget(changed, DELTA_CHAR_BUDGET);
      return {
        after,
        kind: "delta",
        ...(changed.length > kept.length
          ? { omittedLines: changed.length - kept.length }
          : {}),
        summarized: true,
        text: [...gone, ...kept].join("\n"),
      };
    }
  }
  const kept = withinBudget(body, FULL_SNAPSHOT_CHAR_BUDGET);
  const omittedLines = body.length - kept.length;
  return {
    after,
    kind: "full",
    ...(omittedLines > 0 ? { omittedLines } : {}),
    text: kept.join("\n"),
  };
}

/** The leading lines that fit in `budget` characters. */
function withinBudget(lines: readonly string[], budget: number): string[] {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > budget) {
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }
  return kept;
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
  const where = pageName(page);
  const head = `Page after \`${page.after}\`${where === undefined ? "" : ` on ${where}`} (${source}, run for you)`;
  // Ahead of the controls, since it is the page's answer to what was just
  // done and the controls are what is left to do next.
  const said =
    page.said === undefined ? [] : [`The page's own message: ${page.said}`];
  switch (page.kind) {
    case "unchanged": {
      return [
        `${head}: no interactive element changed since the page's last snapshot. Text outside the controls is not compared; read it with \`get text\` if the action should have changed it.`,
        ...said,
      ].join("\n");
    }
    case "delta": {
      if (page.summarized) {
        const omitted =
          page.omittedLines === undefined
            ? ""
            : `\n${page.omittedLines} more changed controls are not shown.`;
        return [
          `${head}: much of the page changed since its last snapshot, so below are only the controls added, removed or renamed, and every other ref is as it was. Run \`agent-browser snapshot -i\` for the page as it is now, or add \`-s <selector>\` for one region.`,
          ...said,
          (page.text || "No control was added, removed or renamed.") + omitted,
        ].join("\n");
      }
      return [
        `${head}: only what changed since the page's last snapshot is below, and every other element and ref is as it was. If you no longer have that snapshot, run \`agent-browser snapshot -i\`.`,
        ...said,
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
        `${head}. Act on these refs directly instead of taking another snapshot; run one only for what this leaves out (\`snapshot -i --urls\` for link addresses).`,
        ...said,
        page.text + omitted,
      ].join("\n");
    }
  }
}

const TabsSchema = z.object({
  data: z.object({
    tabs: z.array(
      z.object({
        active: z.boolean().optional(),
        title: z.string().optional(),
        url: z.string().optional(),
      }),
    ),
  }),
});

/**
 * The title and address of the tab the commands are acting on, from
 * {@link FOLLOW_UP_TABS_ARGS}. Nothing for output that is not the JSON
 * expected, or a tab that reports neither: the attachment is worth having
 * without them.
 */
export function activeTab(output: string): { title?: string; url?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return {};
  }
  const tabs = TabsSchema.safeParse(parsed);
  if (!tabs.success) {
    return {};
  }
  const active =
    tabs.data.data.tabs.find((tab) => tab.active) ?? tabs.data.data.tabs[0];
  const title = active?.title?.trim();
  return {
    ...(title ? { title } : {}),
    ...(active?.url ? { url: active.url } : {}),
  };
}

/** The page's own message, cut to one sentence's worth. */
function clip(text: string, budget: number): string {
  const oneLine = text.replaceAll(/\s*\n\s*/g, " ").trim();
  return oneLine.length > budget ? `${oneLine.slice(0, budget)}…` : oneLine;
}

/**
 * The page the attachment is of, named the way a person would: its title and
 * its address, or whichever of the two came back. Nothing where neither did,
 * and then the attachment says what it said before any of this, since a line
 * naming no page is worse than a line that does not mention one.
 */
function pageName(page: PageAfter): string | undefined {
  const title = page.title?.trim();
  if (page.url === undefined) {
    return title ? `“${title}”` : undefined;
  }
  return title ? `“${title}”, ${page.url}` : page.url;
}
