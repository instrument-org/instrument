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
  /**
   * `messages` is the page's messages alone, after a call whose own read of
   * the page (`snapshot -i`) shows no text outside the controls.
   */
  kind: z.enum(["delta", "full", "messages", "unchanged"]),
  /** Lines of a full snapshot left out to keep the attachment bounded. */
  omittedLines: z.number().int().optional(),
  /**
   * A delta whose changed region was too long to show, given instead as the
   * controls that came, went or were renamed.
   */
  summarized: z.boolean().optional(),
  /**
   * What the page announced with this step, from its live regions (alert,
   * status, `output`, `aria-live`), one region a line. A control renaming
   * itself is all the snapshot shows of a refused sign-in, and nothing at all
   * of a save that went through; this is the sentence beside it.
   */
  said: z.string().optional(),
  /**
   * Live-region text the follow-up had no earlier reading of, so it may be
   * from before this step: shown, and said to be possibly old.
   */
  showing: z.string().optional(),
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
 * Reads the page's ARIA live regions, the elements a page writes its messages
 * to for a screen reader to announce: `role` alert or status, `<output>`, and
 * `aria-live` polite or assertive. `role=log`, `marquee` and `timer` are left
 * out, since they are transcripts and clocks rather than a reply to a step.
 * So is a region with a form field in it or more than a few links and
 * buttons, which is a form or a widget a page marked live (a sign-in form, a
 * carousel) rather than a message; a region inside one is read on its own.
 *
 * Run once with `settleMs` 0 before an action, to read what the regions say
 * then, and again in the follow-up, which reports what changed between the
 * two. The first run in a document also starts a mutation observer kept on
 * the window, which stamps each region when anything in or around it changes,
 * so a message rewritten with the same words still counts as new.
 *
 * Given `settleMs`, it waits until that long after `since`, the time the
 * step began, for a region to change when the page has one and none has
 * changed since then: a save that answers once its request returns can
 * write its message after the snapshot. Pages with no live region, which is
 * most, never wait, and neither does a call that already spent that long
 * after the step.
 *
 * Returns the time the document began loading, its address without the
 * fragment, which together tell one document from the next, and, for each
 * outermost message region with visible text, that text (cut to a few
 * sentences), when the observer last saw it change, whether an earlier run
 * read it, and whether its text is what that run read.
 */
const LIVE_REGIONS_SCRIPT = `(async (since, settleMs) => {
  const SELECTOR = '[role~="alert"],[role~="status"],output,[aria-live="polite"],[aria-live="assertive"]';
  const FIELDS = 'input:not([type="hidden"]),select,textarea,[contenteditable=""],[contenteditable="true"],[role~="textbox"],[role~="searchbox"],[role~="combobox"],[role~="listbox"],[role~="slider"],[role~="spinbutton"]';
  const CONTROLS = 'a[href],button,[role~="button"],[role~="link"],[role~="checkbox"],[role~="radio"],[role~="switch"],[role~="tab"],[role~="menuitem"],[role~="option"]';
  const MAX_CONTROLS = 3;
  const key = Symbol.for("instrument.liveRegions");
  let state = window[key];
  if (!state) {
    state = { changedAt: new WeakMap(), read: new WeakMap(), wake: null };
    const stamp = (region) => { state.changedAt.set(region, Date.now()); state.wake?.(); };
    const touched = (node, within) => {
      const el = node.nodeType === 1 ? node : node.parentElement;
      if (!el) return;
      for (let at = el.closest(SELECTOR); at; at = at.parentElement?.closest(SELECTOR) ?? null) stamp(at);
      if (within) for (const inner of el.querySelectorAll(SELECTOR)) stamp(inner);
    };
    new MutationObserver((records) => {
      for (const record of records) {
        touched(record.target, record.type === "attributes");
        for (const added of record.addedNodes) touched(added, true);
      }
    }).observe(document.documentElement, {
      attributeFilter: ["aria-hidden", "aria-live", "class", "hidden", "role", "style"],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    Object.defineProperty(window, key, { value: state });
  }
  const isMessage = (el) => !el.querySelector(FIELDS) && el.querySelectorAll(CONTROLS).length <= MAX_CONTROLS;
  const regions = () => {
    const messages = [...document.querySelectorAll(SELECTOR)].filter(isMessage);
    const kept = new Set(messages);
    const inKept = (el) => {
      for (let at = el.parentElement?.closest(SELECTOR); at; at = at.parentElement?.closest(SELECTOR) ?? null) if (kept.has(at)) return true;
      return false;
    };
    return messages.filter((el) => !inKept(el)).map((el) => {
      const shown = (el.checkVisibility?.() ?? true) && !el.closest('[aria-hidden="true"]');
      return { el, text: shown ? el.innerText.replace(/\\s+/g, " ").trim().slice(0, 1000) : "" };
    });
  };
  const loadedAt = performance.timeOrigin;
  const url = location.origin + location.pathname + location.search;
  let found = regions();
  const quiet = found.every(({ el, text }) => (state.changedAt.get(el) ?? 0) < since && (!state.read.has(el) || state.read.get(el) === text));
  const left = since + settleMs - Date.now();
  if (left > 0 && loadedAt < since && found.length > 0 && quiet) {
    await new Promise((resolve) => {
      const giveUp = setTimeout(resolve, left);
      state.wake = () => { state.wake = null; clearTimeout(giveUp); setTimeout(resolve, 50); };
    });
    state.wake = null;
    found = regions();
  }
  const result = found.filter(({ text }) => text !== "").map(({ el, text }) => ({
    changedAt: state.changedAt.get(el) ?? null,
    read: state.read.has(el),
    same: state.read.get(el) === text,
    text,
  }));
  for (const { el, text } of found) state.read.set(el, text);
  return { loadedAt, regions: result, url };
})`;

/** The `eval` that reads the live regions; see {@link LIVE_REGIONS_SCRIPT}. */
export function liveRegionsArgs({
  settleMs,
  since,
}: {
  settleMs: number;
  since: number;
}): string[] {
  return ["--json", "eval", `${LIVE_REGIONS_SCRIPT}(${since}, ${settleMs})`];
}

/**
 * How long after an action began the follow-up waits for a quiet live region
 * to announce something. A save answered over loopback with no delay wrote its
 * message after the snapshot in most tries; this also covers a backend that
 * takes a few hundred milliseconds. An action on a page with a live region
 * that announces nothing pays all of it.
 */
export const LIVE_REGION_SETTLE_MS = 500;

/** How much of what the page announced is carried; it is a sentence, not a page. */
const SAID_CHAR_BUDGET = 400;

/** Below this much budget left, a further region is counted instead of cut to a stub. */
const SAID_MIN_REGION_CHARS = 40;

const LiveRegionsSchema = z.object({
  data: z.object({
    result: z.object({
      loadedAt: z.number(),
      url: z.string(),
      regions: z.array(
        z.object({
          changedAt: z.number().nullable(),
          read: z.boolean(),
          same: z.boolean(),
          text: z.string(),
        }),
      ),
    }),
  }),
});

/**
 * The document a reading of the live regions was taken in: when it began
 * loading and its address without the fragment. A navigation, or a
 * client-side route change that rewrites the address, gives another.
 */
export type PageDocument = { loadedAt: number; url: string };

function parseLiveRegions(output: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return undefined;
  }
  const live = LiveRegionsSchema.safeParse(parsed);
  return live.success ? live.data.data.result : undefined;
}

/** The document a reading before an action was taken in, from its output. */
export function liveRegionDocument(output: string): PageDocument | undefined {
  const live = parseLiveRegions(output);
  return live && { loadedAt: live.loadedAt, url: live.url };
}

/** Whether two readings were taken in the same document. */
function sameDocument(a: PageDocument, b: PageDocument): boolean {
  return a.loadedAt === b.loadedAt && a.url === b.url;
}

/**
 * What the page announced since `since`, from {@link liveRegionsArgs}'s
 * output. Nothing when the page is another document than `before`, the one
 * the reading before the step was taken in, or one that loaded after the step
 * began: every region of a page just loaded reads as new, and that is the
 * page's furniture (a banner, a footer) rather than an answer to the step.
 * Otherwise a region counts as announced when the observer saw it change
 * after `since`, or when its text is not what the reading before the action
 * found. One the reading before never saw, with no change seen, has no
 * reading to compare against, so it is shown as text that may predate the
 * step; one that was read and has not changed is left out, since it is old
 * news. Nothing for output that is not the JSON expected.
 */
export function liveRegionText(
  output: string,
  since: number,
  before?: PageDocument,
): { said?: string; showing?: string } {
  const live = parseLiveRegions(output);
  if (
    live === undefined ||
    live.loadedAt >= since ||
    (before !== undefined && !sameDocument(before, live))
  ) {
    return {};
  }
  const said: string[] = [];
  const showing: string[] = [];
  for (const { changedAt, read, same, text } of live.regions) {
    if ((changedAt !== null && changedAt >= since) || (read && !same)) {
      said.push(text);
    } else if (!read) {
      showing.push(text);
    }
  }
  const saidLines = withinSaidBudget(said, SAID_CHAR_BUDGET);
  const showingLines = withinSaidBudget(
    showing,
    SAID_CHAR_BUDGET - saidLines.join("\n").length,
  );
  return {
    ...(saidLines.length > 0 ? { said: saidLines.join("\n") } : {}),
    ...(showingLines.length > 0 ? { showing: showingLines.join("\n") } : {}),
  };
}

/**
 * Each message cut to what is left of `budget`, and once too little is left,
 * a count of the ones that did not fit.
 */
function withinSaidBudget(messages: readonly string[], budget: number) {
  const kept: string[] = [];
  let left = budget;
  for (const [index, message] of messages.entries()) {
    if (left < SAID_MIN_REGION_CHARS) {
      kept.push(`and ${messages.length - index} more`);
      break;
    }
    const line = clip(message, left);
    kept.push(line);
    left -= line.length + 1;
  }
  return kept;
}

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

/** Characters of the refs a delta says left the page, before the rest are only counted. */
const GONE_CHAR_BUDGET = 400;

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
 * Whether a command acts on the page it is on, rather than loading another:
 * the live regions are read before it, so the follow-up can tell what it
 * changed in them, and the follow-up waits a moment for a quiet one. A
 * navigation needs neither, since its page's messages are not reported.
 */
export function readsLiveRegionsFirst(args: string[]): boolean {
  const { subArgs, subcommand } = parseAgentBrowserArgs(args);
  if (subcommand === undefined) {
    return false;
  }
  if (ACTIONS.has(subcommand)) {
    return true;
  }
  return (
    LOCATORS.has(subcommand) &&
    subArgs.slice(1).some(({ value }) => ACTIONS.has(value))
  );
}

/**
 * Whether a read puts the page's text in front of the model, its messages
 * among it. A `snapshot -i` is the controls alone, and `get value`, `attr`
 * and the like are one field.
 */
export function showsPageText(args: string[]): boolean {
  const { subArgs, subcommand } = parseAgentBrowserArgs(args);
  const rest = subArgs.slice(1).map(({ value }) => value);
  switch (subcommand) {
    case "get": {
      return rest[0] === "text" || rest[0] === "html";
    }
    case "snapshot": {
      return !rest.includes("-i") && !rest.includes("--interactive");
    }
    default: {
      return subcommand !== undefined && READS.has(subcommand);
    }
  }
}

/**
 * One bash call's record of whether the page still needs showing. Each
 * successful command that changes the page replaces what is pending with a way
 * to snapshot it; each read clears it; everything else leaves it alone, so the
 * last change wins and a chain ending in a read attaches nothing.
 */
/** What one follow-up read of the page came back with. */
interface PageRead {
  /** What the page announced with the step, from {@link liveRegionText}. */
  said?: string;
  /** Live-region text with no earlier reading to compare against. */
  showing?: string;
  snapshot: string;
  title?: string;
  url?: string;
}

/**
 * How a follow-up reads the page: `snapshot` whether to take the snapshot,
 * the page's name and all, and `messages` whether to read what the page
 * announced, given when the first change it reports began (`since`), the
 * document the reading before it was taken in (`before`), and how long after
 * `since` to wait for the page to announce (`settleMs`).
 */
type ReadPage = (
  signal: AbortSignal,
  options: {
    messages?: { before?: PageDocument; settleMs: number; since: number };
    snapshot: boolean;
  },
) => Promise<PageRead | undefined>;

/**
 * Whether a page-changing command acts on the page it is on, so what the page
 * announces next is its answer to it. A navigation or a tab switch puts
 * another page up, whose live regions all read as new and say nothing about
 * the step. `dialog accept` answers a dialog the page opened, which it can
 * reply to like a click.
 */
function staysOnPage(args: string[]): boolean {
  return (
    readsLiveRegionsFirst(args) ||
    parseAgentBrowserArgs(args).subcommand === "dialog"
  );
}

export class BrowserFollowUp {
  /** The last change since the page was last read, which the snapshot is after. */
  #pending: { after: string; read: ReadPage } | undefined;

  /**
   * The in-page actions since the page's text was last read, from the first
   * one in the current document: when it began, and the document the reading
   * before it was taken in. A `snapshot -i` reads the controls and none of
   * the text, so it ends what is pending above and not this: the page's
   * messages are still unseen. A navigation ends it, since nothing it
   * announced is an answer to it.
   */
  #unread:
    | {
        after: string;
        before?: PageDocument;
        read: ReadPage;
        settles: boolean;
        since: number;
      }
    | undefined;

  note({
    args,
    before,
    exitCode,
    read,
    startedAt,
  }: {
    args: string[];
    /** The document the live regions were read in before the command, when they were. */
    before?: PageDocument;
    exitCode: number;
    read: ReadPage;
    /** When the command began, in epoch milliseconds. */
    startedAt: number;
  }) {
    const effect = pageEffect(args);
    if (effect === "reads") {
      this.#pending = undefined;
      if (showsPageText(args)) {
        this.#unread = undefined;
      }
    } else if (effect === "changes" && exitCode === 0) {
      const { subcommand = "" } = parseAgentBrowserArgs(args);
      this.#pending = { after: subcommand, read };
      if (!staysOnPage(args)) {
        this.#unread = undefined;
        return;
      }
      // From the first change since: what the page announced after an
      // earlier click in the same call is news too, unless that click loaded
      // the document this one acts on.
      const earlier = this.#unread;
      const continues =
        earlier !== undefined &&
        (before === undefined ||
          (before.loadedAt < earlier.since &&
            (earlier.before === undefined ||
              sameDocument(before, earlier.before))));
      const baseline = continues ? (earlier.before ?? before) : before;
      this.#unread = {
        after: subcommand,
        read,
        settles: readsLiveRegionsFirst(args),
        since: continues ? earlier.since : startedAt,
        ...(baseline ? { before: baseline } : {}),
      };
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

  /**
   * Read the page if it is still pending, once: the snapshot and the page's
   * messages, or the messages alone when the call read the controls itself.
   */
  async take(signal: AbortSignal): Promise<PageAfter | undefined> {
    const pending = this.#pending;
    const unread = this.#unread;
    this.#pending = undefined;
    this.#unread = undefined;
    const last = pending ?? unread;
    if (last === undefined) {
      return undefined;
    }
    try {
      const page = await last.read(
        AbortSignal.any([signal, AbortSignal.timeout(FOLLOW_UP_TIMEOUT_MS)]),
        {
          ...(unread === undefined
            ? {}
            : {
                messages: {
                  ...(unread.before ? { before: unread.before } : {}),
                  settleMs: unread.settles ? LIVE_REGION_SETTLE_MS : 0,
                  since: unread.since,
                },
              }),
          snapshot: pending !== undefined,
        },
      );
      if (page === undefined) {
        return undefined;
      }
      if (pending === undefined) {
        return page.said === undefined && page.showing === undefined
          ? undefined
          : {
              after: last.after,
              kind: "messages",
              text: "",
              ...(page.said === undefined ? {} : { said: page.said }),
              ...(page.showing === undefined ? {} : { showing: page.showing }),
            };
      }
      const parsed = parseFollowUpSnapshot(page.snapshot, pending.after);
      return parsed === undefined
        ? undefined
        : {
            ...parsed,
            ...(page.said === undefined ? {} : { said: page.said }),
            ...(page.showing === undefined ? {} : { showing: page.showing }),
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
      const goneShown = withinBudget(removed, GONE_CHAR_BUDGET);
      const gone =
        removed.length > 0
          ? [
              `No longer on the page: ${goneShown.join(", ")}${removed.length > goneShown.length ? `, and ${removed.length - goneShown.length} more` : ""}`,
            ]
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
            : op === "replace"
              ? [
                  `- ${ref} ${field ?? "name"} is now ${typeof value === "string" && value !== "" ? JSON.stringify(value) : "empty"}`,
                ]
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
  const said = [
    ...messageLines(
      ["The page's own message", "The page's own messages"],
      page.said,
    ),
    ...messageLines(
      [
        "The page's status text, which may be from before this step",
        "The page's status texts, which may be from before this step",
      ],
      page.showing,
    ),
  ];
  switch (page.kind) {
    case "messages": {
      return [
        `Messages on the page after \`${page.after}\` (its live regions, read for you, since \`snapshot -i\` leaves out text):`,
        ...said,
      ].join("\n");
    }
    case "unchanged": {
      return [
        `${head}: no interactive element changed since the page's last snapshot. Text outside the controls is compared only where the page announces it (below, when it did); read the rest with \`get text\` if the action should have changed it.`,
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
          `${head}: much of the page changed since its last snapshot, so below are only the controls added, removed or renamed. A control's state (checked, expanded, its value) is not compared here. Run \`agent-browser snapshot -i\` for the page as it is now, or add \`-s <selector>\` for one region.`,
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

/**
 * The page's messages under a label: one on the label's line, several as a
 * list below the plural one.
 */
function messageLines(
  [one, several]: [string, string],
  messages: string | undefined,
): string[] {
  const lines = messages?.split("\n") ?? [];
  if (lines.length <= 1) {
    return lines.map((line) => `${one}: ${line}`);
  }
  return [`${several}:`, ...lines.map((line) => `- ${line}`)];
}

/** One message, on one line and cut to `budget` characters. */
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
