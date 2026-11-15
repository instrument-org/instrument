import {
  filePathOfInstrumentLink,
  instrumentLinkOf,
  isInstrumentAddress,
} from "@instrument-org/shared";
import { z } from "zod";

import { LayoutSnapshotSchema } from "../../schemas/group-layout";
import {
  type WindowTabAction,
  type WindowTabTarget,
} from "../../schemas/window-tab";
import {
  layoutTabName,
  showingLine,
  tabPlace,
} from "../../model-text/notes/group-layout-model-text";
import { parseBrowserTargetId } from "../../types";
import { noteBrowserAgentActivity } from "../browser-agent-activity";
import { recordAsk } from "../chat/asks";
import { askWindow, WINDOW_TAB_TIMEOUT_MS } from "../chat/window-tab";
import { tabHolders } from "../chat/chat-tabs";
import { agentPathOfFileUrl, isLocalAddress } from "../local-page-address";
import { recordRaisedAsk } from "../shell-commands/raised-asks";
import {
  WAITING_IS_THE_CHATS,
  WINDOW_COMMAND,
  WINDOW_IS_THE_CHATS,
} from "../../model-text/commands/window-command";
import { getWorkspaceConfig } from "../workspace-config";
import { type CapabilityContext, defineCapability } from "./define";

const NAME = WINDOW_COMMAND.name;

const NO_WINDOW = "the window did not answer, so no tab changed.";

/** Changing what the person sees is the chat's. */
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
  switch (target.kind) {
    case "app": {
      return target.address;
    }
    case "page": {
      return target.url ?? "a new page";
    }
    case "path": {
      return target.path;
    }
  }
}

/** The agent opening a page is its first work in it, which the tab's working mark shows from the start. */
function noteOpenedPage(tabId: string | undefined) {
  const targetId = parseBrowserTargetId(tabId ?? "");
  if (targetId !== null) {
    noteBrowserAgentActivity(targetId);
  }
}

/**
 * What an argument asks a tab to show: a page by its address, a chat, an
 * app, a task or a built-in page by its `instrument://` address, or a file or
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
  if (isInstrumentAddress(arg)) {
    // A file's app address names its path, which opens as the path does.
    const path = filePathOfInstrumentLink(arg);
    if (path !== undefined) {
      return targetOf(path, ctx);
    }
    return instrumentLinkOf(arg) === undefined
      ? { error: `"${arg}" names nothing the window shows.` }
      : { address: arg, kind: "app" };
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
  input: z.object({
    group: z.string().optional().meta({
      description:
        "A tab group's id; by default the group of the chat's tab the person last sent from.",
    }),
  }),
  name: "window.list",
  output: z.object({
    layout: LayoutSnapshotSchema,
    /** The task at work in a tab, by the tab's id, and whether that is the session asking. */
    tasks: z.record(
      z.string(),
      z.object({ id: z.string(), title: z.string(), you: z.boolean() }),
    ),
  }),
  async run({ group }, ctx) {
    const answer = await ask(
      { kind: "list", ...(group === undefined ? {} : { group }) },
      ctx,
    );
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    if (answer.error || !answer.read) {
      throw new Error(answer.error ?? NO_WINDOW);
    }
    const holders = await tabHolders(ctx.chatId);
    return {
      layout: answer.read.layout,
      tasks: Object.fromEntries(
        [...holders].map(([tab, holder]) => [
          tab,
          {
            id: holder.id,
            title: holder.title,
            you: holder.session === ctx.sessionId,
          },
        ]),
      ),
    };
  },
  summary:
    "A tab group's sides and tabs, one line each, by default the group the chat works in: the id every other subcommand and `agent-browser tab` take, which tab each side shows and which are hidden behind it, which side has the keyboard, what each tab has open, and which task is at work in it; then what the user sees.",
  surfaces: {
    cli: { help: "", positional: ["group"], words: ["window", "list"] },
    script: { positional: ["group"] },
  },
  text: ({ layout, tasks }) => {
    const isTwo = layout.sides.length === 2;
    return [
      ...layout.sides.flatMap(({ tabs }, side) => [
        ...(isTwo
          ? [
              `${side === 0 ? "left" : "right"}${layout.focused === side ? " (keyboard)" : ""}:`,
            ]
          : []),
        ...tabs.map((tab) => {
          const task = tasks[tab.id];
          // Every tab but a New Tab by an address `show` takes again: a
          // site's URL, a file's or folder's path, the app's own address.
          const shows =
            tab.kind === "website" && tab.title !== ""
              ? `${tab.title} · ${tab.address}`
              : isInstrumentAddress(tab.address) && tab.kind !== "newChat"
                ? `${layoutTabName(tab)} · ${tab.address}`
                : layoutTabName(tab);
          return `${isTwo ? "  " : ""}${tab.id}  ${tab.isUp ? "showing" : "hidden "}  ${shows}${tab.isThisChat ? " (you)" : ""}${task ? (task.you ? "  you are working in it" : `  task ${task.id} is working in it`) : ""}`;
        }),
      ]),
      showingLine(layout),
    ].join("\n");
  },
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
    "The text of the page in a tab, as the user sees it, signed in where they are, and what each of its form fields holds now.",
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
    "Show each to the user: a url, file, folder or app address (a chat, an app, a task, a built-in page) opens in a tab of its own, never in place of you, printing the tab's id, which `agent-browser tab` takes, and where it landed; a tab's id makes it the tab its side shows.",
  surfaces: {
    cli: {
      flagNames: { into: "in" },
      help: "A path is a file or folder you can read; an app address is the instrument://\naddress `window list` prints. It opens nothing in the user's own\napplications and downloads nothing.",
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
          said: `Tab ${arg}: ${(await placeOf(arg, ctx)) ?? "showing on its side"}.`,
          tab: arg,
          target: arg,
        }
      : { failed: true, said: error, target: arg };
  }
  const target = await targetOf(arg, ctx);
  if ("error" in target) {
    return { failed: true, said: target.error, target: arg };
  }
  const answer = await ask({ kind: "open", show: true, target }, ctx);
  if (answer?.error) {
    return { failed: true, said: answer.error, target: arg };
  }
  const tabId = answer?.tabId;
  noteOpenedPage(tabId);
  // With no window to answer the page still counts as opened: it is the
  // tab's id that is missing, not the page.
  const place =
    tabId === undefined
      ? undefined
      : ((await placeOf(tabId, ctx)) ??
        (answer?.behind
          ? "hidden behind another tab, since the user is working on that side"
          : undefined));
  return {
    failed: false,
    said: `Opened ${describeTarget(target)}${tabId ? ` (tab ${tabId})` : ""}${place ? `: ${place}` : ""}.`,
    ...(tabId ? { tab: tabId } : {}),
    target: arg,
  };
}

/** Where a tab stands in the chat's group now, read from the window (`tabPlace`); undefined when the window does not say. */
async function placeOf(tabId: string, ctx: CapabilityContext) {
  const answer = await ask({ kind: "list" }, ctx);
  const layout = answer?.read?.layout;
  return layout === undefined ? undefined : tabPlace(layout, tabId);
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

/**
 * Hands the user a page of the chat's to do there what only they can (a
 * sign-in, a check that they are a person) and waits on them: a card says
 * why, with Done and Skip, the page shows that it waits on them, and the
 * turn ends. Nothing watches the page for them finishing, since no signal
 * says so for every site; Done is how the agent hears it.
 */
/** The form `wait` takes, as its errors spell it. */
const WAIT_FORM =
  "<id> --title '<what to do, a few words>' --reason '<why, one short sentence>'";
const WAIT_TITLE = "--title '<what to do, a few words>', the card's title";
const WAIT_REASON =
  "--reason '<why, one short sentence>', which the card shows under the title";

export const windowWait = defineCapability({
  input: z.object({
    tab: TabField("wait", WAIT_FORM),
    title: z.string({ error: `wait needs ${WAIT_TITLE}.` }).meta({
      description:
        "What the user does there, in a few words starting with a verb: Log in to Shopify, Confirm you're human.",
    }),
    reason: z.string({ error: `wait needs ${WAIT_REASON}.` }).meta({
      description:
        "Why the work needs it, in one short sentence the card shows under the title.",
    }),
  }),
  name: "window.wait",
  output: z.string(),
  async run({ reason, tab, title }, ctx) {
    if (!title.trim()) {
      throw new Error(`wait needs ${WAIT_TITLE}.`);
    }
    if (!reason.trim()) {
      throw new Error(`wait needs ${WAIT_REASON}.`);
    }
    const own = await ask({ kind: "list" }, ctx);
    if (!own) {
      throw new Error(NO_WINDOW);
    }
    const page = own.pages?.find((each) => each.id === tab);
    if (!page) {
      throw new Error(
        own.read?.layout.sides.some((side) =>
          side.tabs.some((each) => each.id === tab),
        )
          ? `tab ${tab} is not a page: wait is for a page the user has something to do in.`
          : `no tab ${tab} in this chat. \`${NAME} list\` names its tabs.`,
      );
    }
    // Showing, so the page they are asked to use is the one they see.
    await ask({ kind: "show", tabId: tab }, ctx);
    const askId = await recordAsk(
      { ...ctx.asker, reason: reason.trim(), title: title.trim() },
      "page",
      tab,
      { page: { title: page.title, url: page.url } },
    );
    recordRaisedAsk(askId);
    return `Showed the user tab ${tab} ("${page.title || page.url}") with a card titled "${title.trim()}", your reason, Done and Skip. Your turn ends here; their answer wakes you.`;
  },
  summary:
    "Hand the user a page of this chat's for what only they can do there (sign in, prove they are a person) and wait: a card shows your title and reason with Done and Skip, your turn ends, and their answer wakes you.",
  surfaces: {
    cli: { help: "", positional: ["tab"], words: ["window", "wait"] },
  },
  text: (said) => said,
  where: { roleRefusal: WAITING_IS_THE_CHATS, roles: ["chat"] },
});
