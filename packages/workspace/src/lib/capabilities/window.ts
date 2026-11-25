import {
  chatAddressOf,
  filePathOfInstrumentLink,
  groupAddressOf,
  instrumentLinkOf,
  isInstrumentAddress,
} from "@instrument-org/shared";
import { z } from "zod";

import { type ChatId } from "../../schemas/chat-id";
import {
  type LayoutSnapshot,
  type ListedGroup,
  ListedGroupSchema,
} from "../../schemas/group-layout";
import {
  type WindowTabAction,
  type WindowTabTarget,
} from "../../schemas/window-tab";
import {
  layoutTabName,
  showingLine,
  tabPlace,
} from "../../model-text/notes/group-layout-model-text";
import {
  allWindowsLines,
  groupLines,
  groupNamed,
  type ListFacts,
  otherGroupsLine,
  type WindowGroups,
} from "../../model-text/notes/window-list-model-text";
import { parseBrowserTargetId } from "../../types";
import { noteBrowserAgentActivity } from "../browser-agent-activity";
import { ChatStateSchema, chatStateOf } from "../chat/chat-state";
import { listChats } from "../chat/chats";
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
import { projectsInUse } from "./projects";
import {
  ABOVE_REPLY_BOX,
  MOVE_TO_NEW_TAB_GROUP,
  RECENTLY_CLOSED,
  WAIT_CARD_WORDS,
} from "../screen-words";

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

/** Whether an argument names a tab group by its id. */
function isGroupId(arg: string): boolean {
  return /^group:[\w-]+$/.test(arg);
}

/**
 * An argument as the id it names: a tab's or a group's `instrument://`
 * address is that tab or group, the way a reply links it.
 */
function idOf(arg: string): string {
  const link = instrumentLinkOf(arg);
  return link?.kind === "group" || link?.kind === "tab" ? link.name : arg;
}

/** Every window's tab groups as the window last said, or none when it did not answer. */
async function windowsOf(ctx: CapabilityContext): Promise<WindowGroups> {
  return (await ask({ kind: "list" }, ctx))?.windows ?? [];
}

/** A group's name and address, as a result line names it. */
function groupWords(layout: ListedGroup): string {
  return `"${layout.name}" ${groupAddressOf(layout.group.id)}`;
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
  const url = getWorkspaceConfig().browser.getLoadedDocumentUrl(targetId);
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

/** What a list prints from: the group it is of (none for `--all`), every window's groups, and which task is at work in each tab. */
const ListedSchema = z.object({
  all: z.boolean(),
  /** Where each chat's tab's chat stands, by the tab's id. */
  chats: z.record(z.string(), ChatStateSchema),
  layout: ListedGroupSchema.optional(),
  /** The projects in use, their names by the ids the groups have. */
  projects: z.record(z.string(), z.string()),
  /** The task at work in a tab, by the tab's id, and whether that is the session asking. */
  tasks: z.record(
    z.string(),
    z.object({ id: z.string(), title: z.string(), you: z.boolean() }),
  ),
  windows: z.array(
    z.object({
      groups: z.array(ListedGroupSchema),
      isThisWindow: z.boolean().optional(),
    }),
  ),
});

/** What the workspace knows of the chats and projects the windows' groups name. */
async function factsOf(
  windows: WindowGroups,
): Promise<Pick<ListFacts, "chats" | "projects">> {
  const chats = new Map(
    (await listChats()).map((chat) => [chatAddressOf(chat.id), chat]),
  );
  return {
    chats: Object.fromEntries(
      windows
        .flatMap((window) => window.groups)
        .flatMap((group) => group.sides)
        .flatMap((side) => side.tabs)
        .flatMap((tab) => {
          const chat = tab.kind === "chat" ? chats.get(tab.address) : undefined;
          return chat === undefined ? [] : [[tab.id, chatStateOf(chat)]];
        }),
    ),
    projects: Object.fromEntries(
      (await projectsInUse()).map((project) => [project.id, project.name]),
    ),
  };
}

export const windowList = defineCapability({
  input: z.object({
    group: z.string().optional().meta({
      description:
        "A tab group's id or name; by default the group of the chat's tab the person last sent from.",
    }),
    all: z.boolean().default(false).meta({
      description: "Every window's tab groups and their tabs.",
    }),
  }),
  name: "window.list",
  output: ListedSchema,
  async run({ all, group }, ctx) {
    const answer = await ask({ kind: "list" }, ctx);
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    if (answer.error) {
      throw new Error(answer.error);
    }
    const windows = answer.windows ?? [];
    const holders = await tabHolders(ctx.chatId);
    const tasks = Object.fromEntries(
      [...holders].map(([tab, holder]) => [
        tab,
        {
          id: holder.id,
          title: holder.title,
          you: holder.session === ctx.sessionId,
        },
      ]),
    );
    const facts = { tasks, ...(await factsOf(windows)) };
    if (all) {
      return { all, ...facts, windows };
    }
    if (group !== undefined) {
      const named = groupNamed(windows, group);
      if ("error" in named) {
        throw new Error(named.error);
      }
      return { all, layout: named.group, ...facts, windows };
    }
    if (!answer.read) {
      throw new Error(
        `this chat has no tab in any group. \`${NAME} list --all\` lists every group.`,
      );
    }
    const own = answer.read.layout;
    // As its window lists it, which says what a layout alone does not.
    const listed = windows
      .flatMap((window) => window.groups)
      .find((each) => each.group.id === own.group.id);
    return {
      all,
      layout: listed ?? { ...own, name: own.group.id },
      ...facts,
      windows,
    };
  },
  summary:
    "A tab group's sides and tabs, one line each, by default the group the chat works in: the group's address, whether it is pinned, its project, whether it is on screen and when it was last brought up (absent when not known), each tab's id (which every other subcommand and `agent-browser tab` take), where it stands, what it has open and the address a reply links it by, which task is at work in it, whether an agent opened it, words in a new tab not sent yet, and whether its chat is working, waiting on the user or unread and when it was last active; then what the user sees, and the other groups there are. A group is named by its id or its name; --all lists every window's groups, the pinned first.",
  surfaces: {
    cli: { help: "", positional: ["group"], words: ["window", "list"] },
    script: { positional: ["group"] },
  },
  text: ({ all, chats, layout, projects, tasks, windows }) =>
    all || layout === undefined
      ? allWindowsLines(windows, { chats, projects, tasks }).join("\n")
      : [
          ...groupLines(layout, { facts: { chats, projects, tasks } }),
          showingLine(layout),
          otherGroupsLine(windows, layout.group.id),
        ].join("\n"),
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
    group: z.string().optional().meta({
      description:
        "A tab group, by its id or name, to open each in, without the window switching to it.",
    }),
  }),
  name: "window.show",
  output: Outcomes,
  render: renderOutcomes,
  async run({ group, into, targets }, ctx) {
    if (into !== undefined) {
      return [await replace(into, targets, ctx)];
    }
    let inGroup: LayoutSnapshot | undefined;
    if (group !== undefined) {
      const named = groupNamed(await windowsOf(ctx), group);
      if ("error" in named) {
        throw new Error(named.error);
      }
      inGroup = named.group;
    }
    // Each in turn: a tab or a group by its id comes forward, and a page,
    // file or folder opens in a tab of its own.
    const outcomes: Outcome[] = [];
    for (const arg of targets) {
      outcomes.push(await showOne(idOf(arg), ctx, inGroup));
    }
    return outcomes;
  },
  summary:
    "Show each to the user: a url, file, folder or app address (a chat, an app, a task, a built-in page) opens in a tab of its own, never in place of you, printing the tab's id, which `agent-browser tab` takes, and where it landed; a tab's id makes it the tab its side shows, switching the window to its group when another is on screen; a group's id switches the window to that group. With --group, what opens goes into that group and the window stays where it is.",
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

async function showOne(
  arg: string,
  ctx: CapabilityContext,
  inGroup?: LayoutSnapshot,
): Promise<Outcome> {
  if (isGroupId(arg)) {
    const answer = await ask({ group: arg, kind: "showGroup" }, ctx);
    const error = answer ? answer.error : NO_WINDOW;
    if (error !== undefined) {
      return { failed: true, said: error, target: arg };
    }
    const shown = (await windowsOf(ctx))
      .flatMap((window) => window.groups)
      .find((each) => each.group.id === arg);
    return {
      failed: false,
      said: `Tab group ${shown ? groupWords(shown) : arg}: on screen, its window in front.`,
      target: arg,
    };
  }
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
  const answer = await ask(
    {
      kind: "open",
      show: true,
      target,
      ...(inGroup === undefined ? {} : { group: inGroup.group.id }),
    },
    ctx,
  );
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

/**
 * Where a tab stands now, read from the window (`tabPlace`): in the chat's
 * group, or in another group, named; undefined when the window does not say.
 */
async function placeOf(tabId: string, ctx: CapabilityContext) {
  return (await tabStanding(ctx.chatId, tabId))?.place;
}

/**
 * Where a tab of the window stands for a chat, as {@link placeOf} words it,
 * and whether the user sees it: up on its side, in the group on screen.
 * Only reads the window; undefined when it does not say.
 */
export async function tabStanding(
  chatId: ChatId,
  tabId: string,
): Promise<{ place: string; shown: boolean } | undefined> {
  const answer = await askWindow({
    action: { kind: "list" },
    askedBy: chatId,
    group: chatId,
    timeoutMs: WINDOW_TAB_TIMEOUT_MS,
  });
  const own = answer?.read?.layout;
  const place = own === undefined ? undefined : tabPlace(own, tabId);
  if (own !== undefined && place !== undefined) {
    return { place, shown: isTabShown(own, tabId) };
  }
  const layout = (answer?.windows ?? [])
    .flatMap((window) => window.groups)
    .find((each) =>
      each.sides.some((side) => side.tabs.some((tab) => tab.id === tabId)),
    );
  const there = layout === undefined ? undefined : tabPlace(layout, tabId);
  return layout === undefined || there === undefined
    ? undefined
    : {
        place: `in the tab group ${groupWords(layout)}, ${there}`,
        shown: isTabShown(layout, tabId),
      };
}

function isTabShown(layout: LayoutSnapshot, tabId: string): boolean {
  return (
    layout.isShown !== false &&
    layout.sides.some((side) =>
      side.tabs.some((tab) => tab.id === tabId && tab.isUp),
    )
  );
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
  const place = await placeOf(now, ctx);
  return {
    failed: false,
    said: `Tab ${tabId} now shows ${describeTarget(target)}${now !== tabId ? `, as tab ${now}` : ""}${place ? `: ${place}` : ""}.${holder}`,
    tab: now,
    target: arg,
  };
}

export const windowClose = defineCapability({
  input: z.object({
    tabs: z
      .array(z.string(), {
        error: `close needs the id of a tab or a tab group (${NAME} close <id>...).`,
      })
      .min(
        1,
        `close needs the id of a tab or a tab group (${NAME} close <id>...).`,
      ),
  }),
  name: "window.close",
  output: Outcomes,
  render: renderOutcomes,
  async run({ tabs }, ctx) {
    const outcomes: Outcome[] = [];
    for (const arg of tabs) {
      const tabId = idOf(arg);
      if (isGroupId(tabId)) {
        outcomes.push(await closeGroup(tabId, ctx));
        continue;
      }
      const holder = await holderClause(tabId, ctx);
      const side = sideOf(await windowsOf(ctx), tabId);
      const answer = await ask({ kind: "close", tabId }, ctx);
      const error = answer ? answer.error : NO_WINDOW;
      outcomes.push(
        error === undefined
          ? {
              failed: false,
              said: `Closed tab ${tabId}.${side ? await closedSideLine(side, ctx) : ""}${holder}`,
              tab: tabId,
              target: tabId,
            }
          : { failed: true, said: error, target: tabId },
      );
    }
    return outcomes;
  },
  summary: `Close tabs, or a tab group whole by its id; the user can bring back from ${RECENTLY_CLOSED} what was theirs or a pinned group, not an agent's tab they never used; closing leaves its chats working. A pinned group whose last tab closes gets a new tab; its id closes it.`,
  surfaces: {
    cli: { help: "", positional: ["tabs"], words: ["window", "close"] },
  },
  text: (outcomes) => outcomes.map((each) => each.said).join("\n"),
  where: CHATS,
});

/** The group a tab is in and the other tabs on its side, read before it closes. */
function sideOf(windows: WindowGroups, tabId: string) {
  for (const layout of windows.flatMap((window) => window.groups)) {
    const side = layout.sides.find((each) =>
      each.tabs.some((tab) => tab.id === tabId),
    );
    if (side !== undefined) {
      return {
        group: layout.group.id,
        isLastTab: layout.sides.length === 1 && side.tabs.length === 1,
        mates: side.tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id),
      };
    }
  }
  return undefined;
}

/**
 * What the side a tab closed from shows now, read from the window after the
 * close, as a sentence after the one saying it closed; empty when the window
 * does not answer.
 */
async function closedSideLine(
  before: { group: string; isLastTab: boolean; mates: readonly string[] },
  ctx: CapabilityContext,
): Promise<string> {
  const answer = await ask({ kind: "list" }, ctx);
  if (!answer?.windows) {
    return "";
  }
  const layout = answer.windows
    .flatMap((window) => window.groups)
    .find((each) => each.group.id === before.group);
  if (layout === undefined) {
    return " Its tab group closed with it.";
  }
  if (before.isLastTab) {
    return ` It was the last tab of the pinned tab group ${groupAddressOf(before.group)}, which stays, with a new tab.`;
  }
  const where =
    layout.group.id === answer.read?.layout.group.id
      ? ""
      : ` of the tab group ${groupWords(layout)}`;
  const side = layout.sides.find((each) =>
    each.tabs.some((tab) => before.mates.includes(tab.id)),
  );
  if (side === undefined) {
    return ` Its side${where} closed. ${showingLine(layout)}`;
  }
  const up = side.tabs.find((tab) => tab.isUp);
  const name =
    up === undefined ? "nothing" : up.isThisChat ? "you" : layoutTabName(up);
  return ` That side${where} now shows ${name}${layout.isShown === false ? "; the window shows another tab group, so it is out of sight" : ""}.`;
}

/** Closes a group whole, as the sidebar's X does, naming it and its tabs. */
async function closeGroup(
  group: string,
  ctx: CapabilityContext,
): Promise<Outcome> {
  const layout = (await windowsOf(ctx))
    .flatMap((window) => window.groups)
    .find((each) => each.group.id === group);
  const answer = await ask({ group, kind: "closeGroup" }, ctx);
  const error = answer ? answer.error : NO_WINDOW;
  if (error !== undefined) {
    return { failed: true, said: error, target: group };
  }
  const count = layout?.sides.reduce((sum, side) => sum + side.tabs.length, 0);
  return {
    failed: false,
    said: `Closed the tab group ${layout ? groupWords(layout) : group}${count === undefined ? "" : count === 1 ? ", its one tab" : `, its ${count} tabs`}.${answer?.isListed === false ? "" : ` The user can bring it back with Undo or from ${RECENTLY_CLOSED}.`}`,
    target: group,
  };
}

/** The form `wait` takes, as its errors spell it. */
const WAIT_FORM =
  "<id> --title '<what to do, a few words>' --reason '<why, one short sentence>'";
const WAIT_TITLE = "--title '<what to do, a few words>', the card's title";
const WAIT_REASON =
  "--reason '<why, one short sentence>', which the card shows under the title";

/**
 * Hands the user a page of the chat's to do there what only they can (a
 * sign-in, a check that they are a person) and waits on them: a card says
 * why, with Done and Skip, the page shows that it waits on them, and the
 * turn ends. Nothing watches the page for them finishing, since no signal
 * says so for every site; Done is how the agent hears it.
 */
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
    // Showing, so the page they are asked to use is the one they see. A card
    // over a page the window did not show asks for what they cannot do.
    const shown = await ask({ kind: "show", tabId: tab }, ctx);
    const failed = shown ? shown.error : NO_WINDOW;
    if (failed !== undefined) {
      throw new Error(
        `tab ${tab} could not be shown, so no card was raised: ${failed}`,
      );
    }
    const place = await placeOf(tab, ctx);
    const askId = await recordAsk(
      { ...ctx.asker, reason: reason.trim(), title: title.trim() },
      "page",
      tab,
      { page: { title: page.title, url: page.url } },
    );
    recordRaisedAsk(askId);
    return `Showed the user tab ${tab} ("${page.title || page.url}") with a card ${ABOVE_REPLY_BOX} titled "${title.trim()}", your reason, ${WAIT_CARD_WORDS.done} and ${WAIT_CARD_WORDS.skip}.${place ? ` Tab ${tab}: ${place}.` : ""} Your turn ends here; their answer wakes you.`;
  },
  summary: `Hand the user a page of this chat's for what only they can do there (sign in, prove they are a person) and wait: a card shows your title and reason with ${WAIT_CARD_WORDS.done} and ${WAIT_CARD_WORDS.skip}, your turn ends, and their answer wakes you.`,
  surfaces: {
    cli: { help: "", positional: ["tab"], words: ["window", "wait"] },
  },
  text: (said) => said,
  where: { roleRefusal: WAITING_IS_THE_CHATS, roles: ["chat"] },
});

/** A group's layout as every window's list has it, by its id; undefined for one none has. */
async function groupById(group: string, ctx: CapabilityContext) {
  return (await windowsOf(ctx))
    .flatMap((window) => window.groups)
    .find((each) => each.group.id === group);
}

const TabsField = (verb: string, form: string) =>
  z
    .array(z.string(), {
      error: `${verb} needs the id of a tab (${NAME} ${verb} ${form}).`,
    })
    .min(1, `${verb} needs the id of a tab (${NAME} ${verb} ${form}).`);

export const windowGroup = defineCapability({
  input: z.object({ tabs: TabsField("group", "<tab id>...") }),
  name: "window.group",
  output: z.string(),
  async run({ tabs }, ctx) {
    const ids = tabs.map(idOf);
    const answer = await ask({ kind: "groupTabs", tabIds: ids }, ctx);
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    if (answer.error !== undefined || answer.group === undefined) {
      throw new Error(answer.error ?? NO_WINDOW);
    }
    const made = await groupById(answer.group, ctx);
    const words = made ? groupWords(made) : groupAddressOf(answer.group);
    const shown =
      made?.isShown === false
        ? "the window stays on the group it shows"
        : "it is on screen, since the group the window showed had no tab left";
    return `Made the tab group ${words} of ${ids.join(", ")}; ${shown}.`;
  },
  summary: `Make a new tab group of tabs, moved out of their groups as ${MOVE_TO_NEW_TAB_GROUP} moves one, in the window the chat works in; the window stays on the group it shows. The sidebar titles a group by its tabs.`,
  surfaces: {
    cli: { help: "", positional: ["tabs"], words: ["window", "group"] },
  },
  text: (said) => said,
  where: CHATS,
});

export const windowMove = defineCapability({
  input: z.object({
    tabs: TabsField("move", "<tab id>... --group <group>"),
    group: z
      .string({
        error: `move needs the group to move them into: ${NAME} move <tab id>... --group <group>.`,
      })
      .meta({
        description: "The tab group to move them into, by its id or name.",
      }),
  }),
  name: "window.move",
  output: z.string(),
  async run({ group, tabs }, ctx) {
    const named = groupNamed(await windowsOf(ctx), idOf(group));
    if ("error" in named) {
      throw new Error(named.error);
    }
    const ids = tabs.map(idOf);
    const answer = await ask(
      { group: named.group.group.id, kind: "moveTabs", tabIds: ids },
      ctx,
    );
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    if (answer.error !== undefined) {
      throw new Error(answer.error);
    }
    const into = await groupById(named.group.group.id, ctx);
    return `Moved ${ids.join(", ")} into the tab group ${groupWords(named.group)}${into ? `; ${sightOf(into)}` : ""}.`;
  },
  summary:
    "Move tabs into an existing tab group, by its id or name, as dropping each on its row does; a group left with no tab closes, or, pinned, gets a new tab.",
  surfaces: {
    cli: { help: "", positional: ["tabs"], words: ["window", "move"] },
  },
  text: (said) => said,
  where: CHATS,
});

async function pinGroups(
  args: readonly string[],
  pinned: boolean,
  ctx: CapabilityContext,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const arg of args) {
    const named = groupNamed(await windowsOf(ctx), idOf(arg));
    if ("error" in named) {
      outcomes.push({ failed: true, said: named.error, target: arg });
      continue;
    }
    const { id } = named.group.group;
    const words = groupWords(named.group);
    const answer = await ask({ group: id, kind: "pinGroup", pinned }, ctx);
    const error = answer ? answer.error : NO_WINDOW;
    outcomes.push(
      error === undefined
        ? {
            failed: false,
            said:
              (named.group.pinned === true) === pinned
                ? `The tab group ${words} is already ${pinned ? "pinned" : "unpinned"}.`
                : `${pinned ? "Pinned" : "Unpinned"} the tab group ${words}.`,
            target: arg,
          }
        : { failed: true, said: error, target: arg },
    );
  }
  return outcomes;
}

const GroupsField = (verb: string) =>
  z
    .array(z.string(), {
      error: `${verb} needs a tab group (${NAME} ${verb} <group>...).`,
    })
    .min(1, `${verb} needs a tab group (${NAME} ${verb} <group>...).`);

export const windowPin = defineCapability({
  input: z.object({ groups: GroupsField("pin") }),
  name: "window.pin",
  output: Outcomes,
  render: renderOutcomes,
  run: ({ groups }, ctx) => pinGroups(groups, true, ctx),
  summary: "Pin tab groups, by id or name, above the sidebar's others.",
  surfaces: {
    cli: { help: "", positional: ["groups"], words: ["window", "pin"] },
  },
  text: (outcomes) => outcomes.map((each) => each.said).join("\n"),
  where: CHATS,
});

export const windowUnpin = defineCapability({
  input: z.object({ groups: GroupsField("unpin") }),
  name: "window.unpin",
  output: Outcomes,
  render: renderOutcomes,
  run: ({ groups }, ctx) => pinGroups(groups, false, ctx),
  summary: "Take the pin off tab groups, by id or name; they stay open.",
  surfaces: {
    cli: { help: "", positional: ["groups"], words: ["window", "unpin"] },
  },
  text: (outcomes) => outcomes.map((each) => each.said).join("\n"),
  where: CHATS,
});

export const windowPlace = defineCapability({
  input: z.object({
    group: z.string({
      error: `place needs a tab group: ${NAME} place <group> --before <group>.`,
    }),
    before: z.string().optional().meta({
      description: "The group it goes just above, by its id or name.",
    }),
    after: z.string().optional().meta({
      description: "The group it goes just below, by its id or name.",
    }),
  }),
  name: "window.place",
  output: z.string(),
  async run({ after, before, group }, ctx) {
    const beside = before ?? after;
    if (beside === undefined || (before !== undefined && after !== undefined)) {
      throw new Error(
        `place takes one of --before and --after: ${NAME} place <group> --before <group>.`,
      );
    }
    const windows = await windowsOf(ctx);
    const named = groupNamed(windows, idOf(group));
    const anchor = groupNamed(windows, idOf(beside));
    if ("error" in named) {
      throw new Error(named.error);
    }
    if ("error" in anchor) {
      throw new Error(anchor.error);
    }
    const answer = await ask(
      {
        anchor: anchor.group.group.id,
        group: named.group.group.id,
        kind: "placeGroup",
        where: before === undefined ? "after" : "before",
      },
      ctx,
    );
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    if (answer.error !== undefined) {
      throw new Error(answer.error);
    }
    return `Placed the tab group ${groupWords(named.group)} just ${before === undefined ? "below" : "above"} ${groupWords(anchor.group)}.`;
  },
  summary:
    "Move a tab group in the sidebar to just above or below another, each by id or name: both pinned or both not, in the same project, in the window the chat works in.",
  surfaces: {
    cli: { help: "", positional: ["group"], words: ["window", "place"] },
  },
  text: (said) => said,
  where: CHATS,
});

/** Whether a group tabs went into is the one the window shows, as a clause. */
function sightOf(layout: LayoutSnapshot): string {
  return layout.isShown === false
    ? "the window shows another group, so they are out of sight"
    : "it is on screen";
}

/**
 * The tabs a restore brought back, as a sentence: one tab's id and where it
 * stands, or several tabs' ids and whether their group is on screen.
 */
async function restoredLine(
  restored: readonly string[],
  groups: readonly LayoutSnapshot[],
  ctx: CapabilityContext,
): Promise<string> {
  const [first] = restored;
  if (first === undefined) {
    return "";
  }
  if (restored.length === 1) {
    const place = await placeOf(first, ctx);
    return place ? ` Tab ${first}: ${place}.` : ` As tab ${first}.`;
  }
  const layout = groups.find((each) =>
    each.sides.some((side) => side.tabs.some((tab) => tab.id === first)),
  );
  return ` As tabs ${restored.join(", ")}${layout ? `; ${sightOf(layout)}` : ""}.`;
}

/** Every tab id open in any window. */
function tabIdsOf(windows: WindowGroups): Set<string> {
  return new Set(
    windows.flatMap((window) =>
      window.groups.flatMap((layout) =>
        layout.sides.flatMap((side) => side.tabs.map((tab) => tab.id)),
      ),
    ),
  );
}

/** How many History rows a list prints unless asked for another number. */
const HISTORY_LIMIT = 20;

const HISTORY_WORDS = {
  closedGroup: "closed tab group",
  closedSide: "closed side",
  closedTab: "closed tab",
  visit: "visited",
} as const;

export const windowHistory = defineCapability({
  input: z.object({
    closed: z.boolean().default(false).meta({
      description: "Only the tabs, sides and tab groups closed.",
    }),
    limit: z.number().int().min(1).default(HISTORY_LIMIT).meta({
      description: "How many rows, newest first.",
    }),
  }),
  name: "window.history",
  output: z.array(
    z.object({
      address: z.string().optional(),
      at: z.number(),
      context: z.string(),
      id: z.string(),
      kind: z.enum(["closedGroup", "closedSide", "closedTab", "visit"]),
      title: z.string(),
    }),
  ),
  async run({ closed, limit }, ctx) {
    const answer = await ask(
      { closedOnly: closed, kind: "history", limit },
      ctx,
    );
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    if (answer.error !== undefined) {
      throw new Error(answer.error);
    }
    return answer.history ?? [];
  },
  summary:
    "The window's History, newest first, as its History list shows it: the tabs, sides and tab groups closed, each by the id `restore` takes, and the places visited. --closed lists only what was closed.",
  surfaces: {
    cli: { help: "", words: ["window", "history"] },
  },
  text: (rows) =>
    rows.length === 0
      ? "Nothing in History yet."
      : rows
          .map(
            (row) =>
              `${row.kind === "visit" ? "" : `${row.id}  `}${new Date(row.at).toISOString()}  ${HISTORY_WORDS[row.kind]}: ${row.title}${row.context === "" ? "" : ` (${row.context})`}${row.address === undefined ? "" : `  ${row.address}`}`,
          )
          .join("\n"),
});

export const windowRestore = defineCapability({
  input: z.object({
    entry: z.string({
      error: `restore takes the id \`${NAME} history --closed\` prints: ${NAME} restore <id>.`,
    }),
  }),
  name: "window.restore",
  output: z.string(),
  async run({ entry }, ctx) {
    const open = tabIdsOf(await windowsOf(ctx));
    const answer = await ask({ entry, kind: "reopenClosed" }, ctx);
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    if (answer.error !== undefined) {
      throw new Error(answer.error);
    }
    // The window names no tab it brought back, so they are the ones open now
    // that were not before.
    const windows = await windowsOf(ctx);
    const groups = windows.flatMap((window) => window.groups);
    const back =
      answer.group === undefined
        ? undefined
        : groups.find((each) => each.group.id === answer.group);
    const restored = [...tabIdsOf(windows)].filter((id) => !open.has(id));
    return `Restored ${entry}${back ? ` in the tab group ${groupWords(back)}` : ""}, as History's restore does.${await restoredLine(restored, groups, ctx)}`;
  },
  summary:
    "Reopen a closed tab, side or tab group by its History id, exactly as History's restore does.",
  surfaces: {
    cli: { help: "", positional: ["entry"], words: ["window", "restore"] },
  },
  text: (said) => said,
  where: CHATS,
});
