import { z } from "zod";

import {
  type WindowTabAction,
  type WindowTabTarget,
} from "../../schemas/window-tab";
import { parseBrowserTargetId } from "../../types";
import { noteBrowserAgentActivity } from "../browser-agent-activity";
import { recordAsk } from "../chat/asks";
import {
  askWindow,
  tabHolders,
  WINDOW_TAB_TIMEOUT_MS,
} from "../chat/window-tab";
import { agentPathOfFileUrl, isLocalAddress } from "../local-page-address";
import { recordRaisedAsk } from "../shell-commands/raised-asks";
import {
  WINDOW_COMMAND,
  WINDOW_IS_THE_CHATS,
} from "../shell-commands/window-command";
import { getWorkspaceConfig } from "../workspace-config";
import { type CapabilityContext, defineCapability } from "./define";

const NAME = WINDOW_COMMAND.name;

const NO_WINDOW = "the window did not answer, so no tab changed.";

/** Changing what is in front of the person is the chat's. */
const CHATS = { roleRefusal: WINDOW_IS_THE_CHATS, roles: ["chat"] } as const;

/** What one argument of a change came to: done, or why not. */
const Outcome = z.object({
  /** The argument as it was given: a tab's id, an address or a path. */
  target: z.string(),
  /** The tab it is in, where there is one. */
  tab: z.string().optional(),
  failed: z.boolean(),
  said: z.string(),
});
type Outcome = z.output<typeof Outcome>;

const Outcomes = z.array(Outcome);

/**
 * Each argument's line: what was done on stdout, and each failure on stderr,
 * exit 1 when any failed or nothing was done.
 */
function renderOutcomes(outcomes: readonly Outcome[]) {
  const done = outcomes.filter((each) => !each.failed);
  const failed = outcomes.filter((each) => each.failed);
  return {
    exitCode: failed.length > 0 || done.length === 0 ? 1 : 0,
    stderr: failed.map((each) => `${NAME}: ${each.said}\n`).join(""),
    stdout: done.map((each) => `${each.said}\n`).join(""),
  };
}

function ask(action: WindowTabAction, ctx: CapabilityContext) {
  return askWindow({
    action,
    askedBy: ctx.chatId,
    group: ctx.chatId,
    timeoutMs: WINDOW_TAB_TIMEOUT_MS,
  });
}

/** Which task is at work in a tab, as a clause for the line that reports what happened to it. */
async function holderClause(tabId: string, ctx: CapabilityContext) {
  const holder = (await tabHolders(ctx.chatId)).get(tabId);
  return holder
    ? ` Task ${holder.id} ("${holder.title}") was working in it; its next browser command tells it so.`
    : "";
}

/** Whether an argument names a tab rather than a page, file or folder to show. */
function isTabId(arg: string): boolean {
  return /^tab_[0-9A-Za-z]+$/.test(arg);
}

function describeTarget(target: WindowTabTarget) {
  return target.kind === "page" ? (target.url ?? "a new page") : target.path;
}

/** The agent opening a page is its first work in it, which the tab's working mark shows from the start. */
function noteOpenedPage(tabId: string | undefined) {
  const targetId = parseBrowserTargetId(tabId ?? "");
  if (targetId !== null) {
    noteBrowserAgentActivity(targetId);
  }
}

/**
 * What an argument asks a tab to show: a page by its address, or a file or
 * folder the window can show, by its path. A folder is handed on with the
 * trailing slash that names one everywhere else a path reaches the user, so
 * the window has a single opener to answer with rather than one per kind of
 * thing a path can be.
 */
async function targetOf(
  arg: string,
  ctx: CapabilityContext,
): Promise<WindowTabTarget | { error: string }> {
  if (arg.startsWith("http://") || arg.startsWith("https://")) {
    return { kind: "page", url: arg };
  }
  if (ctx.shellPath === undefined) {
    return { error: `"${arg}" is a path, which only the shell resolves.` };
  }
  const found = await ctx.shellPath(arg);
  switch (found.kind) {
    case "none":
      return { error: `"${arg}" does not exist.` };
    case "other":
      return { error: `"${arg}" is not a file or a folder.` };
    case "folder":
      return { kind: "path", path: `${found.path}/` };
    case "file":
      return { kind: "path", path: found.path };
  }
}

/**
 * Whether a page tab is on a file of this computer the chat's own tools
 * could not read, which the window would otherwise read for it.
 */
function showsFileOutside(tabId: string, ctx: CapabilityContext): boolean {
  const targetId = parseBrowserTargetId(tabId);
  if (targetId === null) {
    return false;
  }
  const url = getWorkspaceConfig().browser.getTargetUrl(targetId);
  return (
    url !== undefined &&
    isLocalAddress(url) &&
    (ctx.layout === undefined || agentPathOfFileUrl(ctx.layout, url) === null)
  );
}

function outsideFile(tabId: string) {
  return `tab ${tabId} shows a file outside your folders, so it can't be read.`;
}

const TabField = (verb: string, form: string) =>
  z.string({ error: `${verb} takes one tab id: ${NAME} ${verb} ${form}.` });

export const windowList = defineCapability({
  input: z.object({}),
  name: "window.list",
  output: z.array(
    z.object({
      id: z.string(),
      /** Whether it is the tab the person sees while the chat is on screen. */
      front: z.boolean(),
      kind: z.enum(["page", "screen"]),
      title: z.string().optional(),
      url: z.string().optional(),
      /** The task at work in it, by its handle. */
      task: z.object({ id: z.string(), title: z.string() }).optional(),
    }),
  ),
  async run(_, ctx) {
    const answer = await ask({ kind: "list" }, ctx);
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    if (answer.error) {
      throw new Error(answer.error);
    }
    const holders = await tabHolders(ctx.chatId);
    return (answer.tabs ?? []).map((tab) => {
      const holder = holders.get(tab.id);
      return {
        front: tab.front === true,
        id: tab.id,
        kind: tab.kind,
        ...(tab.kind === "page" ? { title: tab.title, url: tab.url } : {}),
        ...(holder ? { task: holder } : {}),
      };
    });
  },
  summary:
    "The chat's tabs, one line each, as what is in the window: the id every other subcommand and `--tab` take, whether it is in front, what it shows, and which task is at work in it.",
  surfaces: {
    cli: { help: "", words: ["window", "list"] },
    script: {},
  },
  text: (tabs) =>
    tabs.length === 0
      ? "This chat has no tabs in the window."
      : tabs
          .map((tab) => {
            const shows =
              tab.kind === "page"
                ? tab.title
                  ? `${tab.title} · ${tab.url ?? ""}`
                  : (tab.url ?? "")
                : "a screen of the app, not a page";
            return `${tab.id}  ${tab.front ? "in front" : "behind  "}  ${shows}${tab.task ? `  task ${tab.task.id} is working in it` : ""}`;
          })
          .join("\n"),
});

export const windowRead = defineCapability({
  input: z.object({ tab: TabField("read", "<id>") }),
  name: "window.read",
  output: z.string(),
  async run({ tab }, ctx) {
    // Checked on both sides of the read, since a page can take its own tab to
    // another file while the window reads it.
    if (showsFileOutside(tab, ctx)) {
      throw new Error(outsideFile(tab));
    }
    const answer = await ask({ kind: "read", tabId: tab }, ctx);
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    if (answer.error) {
      throw new Error(answer.error);
    }
    if (showsFileOutside(tab, ctx)) {
      throw new Error(outsideFile(tab));
    }
    return answer.text ?? "";
  },
  summary:
    "The text of the page in a tab, as the user sees it, signed in where they are.",
  surfaces: {
    cli: { help: "", positional: ["tab"], words: ["window", "read"] },
    script: { positional: ["tab"] },
  },
  text: (text) => text,
});

export const windowShow = defineCapability({
  input: z.object({
    targets: z
      .array(z.string(), {
        error: `nothing to show: give a url, a path or a tab's id (${NAME} show <url, path or id>...).`,
      })
      .min(
        1,
        `nothing to show: give a url, a path or a tab's id (${NAME} show <url, path or id>...).`,
      ),
    into: z.string().optional().meta({
      description:
        "A tab of the chat's, by its id, to show the one url or path in, in place of what it shows.",
    }),
  }),
  name: "window.show",
  output: Outcomes,
  render: renderOutcomes,
  async run({ into, targets }, ctx) {
    if (into !== undefined) {
      return [await replace(into, targets, ctx)];
    }
    // Each in turn: a tab the chat has by its id comes forward, and a page,
    // file or folder opens in a tab of its own.
    const outcomes: Outcome[] = [];
    for (const arg of targets) {
      outcomes.push(await showOne(arg, ctx));
    }
    return outcomes;
  },
  summary:
    "Put each in front: a url, file or folder opens in a tab of its own, printing the tab's id, which a task takes with --tab; a tab's id brings it forward.",
  surfaces: {
    cli: {
      flagNames: { into: "in" },
      help: "A path is a file or folder you can read. It opens nothing in the user's own\napplications and downloads nothing.",
      positional: ["targets"],
      words: ["window", "show"],
    },
  },
  text: (outcomes) => outcomes.map((each) => each.said).join("\n"),
  where: CHATS,
});

async function showOne(arg: string, ctx: CapabilityContext): Promise<Outcome> {
  if (isTabId(arg)) {
    const answer = await ask({ kind: "show", tabId: arg }, ctx);
    const error = answer ? answer.error : NO_WINDOW;
    return error === undefined
      ? {
          failed: false,
          said: `Tab ${arg} is in front.`,
          tab: arg,
          target: arg,
        }
      : { failed: true, said: error, target: arg };
  }
  const target = await targetOf(arg, ctx);
  if ("error" in target) {
    return { failed: true, said: target.error, target: arg };
  }
  const same = await tabOnSameFile(target, ctx);
  if (same !== undefined) {
    return showInPlaceOf(same, arg, target, ctx);
  }
  const answer = await ask({ kind: "open", show: true, target }, ctx);
  if (answer?.error) {
    return { failed: true, said: answer.error, target: arg };
  }
  const tabId = answer?.tabId;
  noteOpenedPage(tabId);
  // With no window to answer the page still counts as opened: it is the
  // tab's id that is missing, not the page.
  return {
    failed: false,
    said: `Opened ${describeTarget(target)} in front${tabId ? ` (tab ${tabId})` : ""}`,
    ...(tabId ? { tab: tabId } : {}),
    target: arg,
  };
}

/**
 * A page tab of the chat's on a file with the same bytes as the one to show,
 * which no task is working in. A page checked in the work folder and then
 * copied where the user keeps it is one page, so its tab is the one to show
 * the copy in.
 */
async function tabOnSameFile(
  target: WindowTabTarget,
  ctx: CapabilityContext,
): Promise<string | undefined> {
  const { layout, readShellFile, shellPath } = ctx;
  if (
    target.kind !== "path" ||
    target.path.endsWith("/") ||
    layout === undefined ||
    readShellFile === undefined ||
    shellPath === undefined
  ) {
    return undefined;
  }
  const listed = (await ask({ kind: "list" }, ctx))?.tabs ?? [];
  const holders = await tabHolders(ctx.chatId);
  const pages = listed.flatMap((tab) => {
    const path =
      tab.kind === "page" && !holders.has(tab.id) && tab.url
        ? agentPathOfFileUrl(layout, tab.url)
        : null;
    return path === null ? [] : [{ id: tab.id, path }];
  });
  if (pages.length === 0) {
    return undefined;
  }
  const shown = await shellPath(target.path);
  let bytes: Uint8Array | undefined;
  for (const page of pages) {
    const found = await shellPath(page.path);
    if (found.kind !== "file" || found.size !== shown.size) {
      continue;
    }
    if (found.path === shown.path) {
      return page.id;
    }
    bytes ??= await readShellFile(shown.path).catch(() => new Uint8Array());
    const theirs = await readShellFile(found.path).catch(() => undefined);
    if (theirs !== undefined && Buffer.from(theirs).equals(bytes)) {
      return page.id;
    }
  }
  return undefined;
}

/** Shows a file in front, in the tab that showed the same page. */
async function showInPlaceOf(
  tabId: string,
  arg: string,
  target: WindowTabTarget,
  ctx: CapabilityContext,
): Promise<Outcome> {
  const replaced = await ask({ kind: "replace", tabId, target }, ctx);
  const error = replaced ? replaced.error : NO_WINDOW;
  if (error !== undefined) {
    return { failed: true, said: error, target: arg };
  }
  const now = replaced?.tabId ?? tabId;
  await ask({ kind: "show", tabId: now }, ctx);
  return {
    failed: false,
    said: `Opened ${describeTarget(target)} in front (tab ${now}), in place of tab ${tabId}, which showed the same page.`,
    tab: now,
    target: arg,
  };
}

/** Shows something else in a tab the chat has, in its place. */
async function replace(
  tabId: string,
  targets: readonly string[],
  ctx: CapabilityContext,
): Promise<Outcome> {
  const [arg, ...extra] = targets;
  if (arg === undefined || extra.length > 0 || isTabId(arg)) {
    throw new Error(
      `--in takes one url or path to show in the tab: ${NAME} show <url or path> --in <id>.`,
    );
  }
  const target = await targetOf(arg, ctx);
  if ("error" in target) {
    return { failed: true, said: target.error, target: arg };
  }
  const holder = await holderClause(tabId, ctx);
  const answer = await ask({ kind: "replace", tabId, target }, ctx);
  const error = answer ? answer.error : NO_WINDOW;
  if (error !== undefined) {
    return { failed: true, said: error, target: arg };
  }
  // A tab that changes kind, a page becoming a file's tab or the reverse,
  // comes back under a new id, which is the one to use next.
  const now = answer?.tabId ?? tabId;
  return {
    failed: false,
    said: `Tab ${tabId} now shows ${describeTarget(target)}${now !== tabId ? `, as tab ${now}` : ""}.${holder}`,
    tab: now,
    target: arg,
  };
}

export const windowClose = defineCapability({
  input: z.object({
    tabs: z
      .array(z.string(), {
        error: `close needs the id of a tab (${NAME} close <id>...).`,
      })
      .min(1, `close needs the id of a tab (${NAME} close <id>...).`),
  }),
  name: "window.close",
  output: Outcomes,
  render: renderOutcomes,
  async run({ tabs }, ctx) {
    const outcomes: Outcome[] = [];
    for (const tabId of tabs) {
      const holder = await holderClause(tabId, ctx);
      const answer = await ask({ kind: "close", tabId }, ctx);
      const error = answer ? answer.error : NO_WINDOW;
      outcomes.push(
        error === undefined
          ? {
              failed: false,
              said: `Closed tab ${tabId}.${holder}`,
              tab: tabId,
              target: tabId,
            }
          : { failed: true, said: error, target: tabId },
      );
    }
    return outcomes;
  },
  summary: "Close tabs of the chat's.",
  surfaces: {
    cli: { help: "", positional: ["tabs"], words: ["window", "close"] },
  },
  text: (outcomes) => outcomes.map((each) => each.said).join("\n"),
  where: CHATS,
});

export const windowRequest = defineCapability({
  input: z.object({
    tab: TabField("request", "<id> --reason '<one sentence to the user>'"),
    reason: z
      .string({
        error:
          "request needs --reason '<one sentence to the user>', which the card shows them.",
      })
      .meta({
        description: "One sentence to the user, which the card shows them.",
      }),
  }),
  name: "window.request",
  output: z.string(),
  async run({ reason, tab }, ctx) {
    if (!reason.trim()) {
      throw new Error(
        "request needs --reason '<one sentence to the user>', which the card shows them.",
      );
    }
    const own = await ask({ kind: "list" }, ctx);
    if (own?.tabs?.some((each) => each.id === tab)) {
      throw new Error(
        `tab ${tab} is already this chat's: \`${NAME} read ${tab}\` reads it, and \`instrument task new --tab ${tab}\` hands it to a task.`,
      );
    }
    const answer = await ask({ kind: "theirs", tabId: tab }, ctx);
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    const page = answer.tabs?.[0];
    if (answer.error || page?.kind !== "page") {
      throw new Error(
        `no tab ${tab} of the user's is open outside this chat. A request names the tab a note on the user's message showed as theirs.`,
      );
    }
    const askId = await recordAsk(
      { ...ctx.asker, reason: reason.trim() },
      "tab",
      tab,
      { page: { title: page.title, url: page.url } },
    );
    recordRaisedAsk(askId);
    return `Asked the user to move tab ${tab} ("${page.title || page.url}") into this chat. The card shows your reason with Move tab here and Skip. Your turn ends here; their answer wakes you.`;
  },
  summary:
    "Ask the user to move a tab of their own, which the note on their message named outside this chat, into it: a card shows them your reason with Move tab here and Skip, your turn ends, and their answer wakes you.",
  surfaces: {
    cli: { help: "", positional: ["tab"], words: ["window", "request"] },
  },
  text: (said) => said,
  where: CHATS,
});
