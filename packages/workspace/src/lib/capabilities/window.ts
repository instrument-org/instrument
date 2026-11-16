import {
  filePathOfInstrumentLink,
  groupAddressOf,
  instrumentLinkOf,
  isInstrumentAddress,
} from "@instrument-org/shared";
import { z } from "zod";

import {
  type LayoutSnapshot,
  LayoutSnapshotSchema,
} from "../../schemas/group-layout";
import {
  type WindowTabAction,
  type WindowTabTarget,
} from "../../schemas/window-tab";
import {
  showingLine,
  tabPlace,
} from "../../model-text/notes/group-layout-model-text";
import {
  allWindowsLines,
  groupLines,
  groupName,
  groupNamed,
  otherGroupsLine,
  type WindowGroups,
} from "../../model-text/notes/window-list-model-text";
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
function groupWords(layout: LayoutSnapshot): string {
  return `"${groupName(layout)}" ${groupAddressOf(layout.group.id)}`;
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

/** What a list prints from: the group it is of (none for `--all`), every window's groups, and which task is at work in each tab. */
const ListedSchema = z.object({
  all: z.boolean(),
  layout: LayoutSnapshotSchema.optional(),
  /** The task at work in a tab, by the tab's id, and whether that is the session asking. */
  tasks: z.record(
    z.string(),
    z.object({ id: z.string(), title: z.string(), you: z.boolean() }),
  ),
  windows: z.array(
    z.object({
      groups: z.array(LayoutSnapshotSchema),
      isThisWindow: z.boolean().optional(),
    }),
  ),
});

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
    if (all) {
      return { all, tasks, windows };
    }
    if (group !== undefined) {
      const named = groupNamed(windows, group);
      if ("error" in named) {
        throw new Error(named.error);
      }
      return { all, layout: named.group, tasks, windows };
    }
    if (!answer.read) {
      throw new Error(
        `this chat has no tab in any group. \`${NAME} list --all\` lists every group.`,
      );
    }
    return { all, layout: answer.read.layout, tasks, windows };
  },
  summary:
    "A tab group's sides and tabs, one line each, by default the group the chat works in: the group's address and whether it is on screen, each tab's id (which every other subcommand and `agent-browser tab` take), where it stands, what it has open and the address a reply links it by, and which task is at work in it; then what the user sees, and the other groups there are. A group is named by its id or its name; --all lists every window's groups.",
  surfaces: {
    cli: { help: "", positional: ["group"], words: ["window", "list"] },
    script: { positional: ["group"] },
  },
  text: ({ all, layout, tasks, windows }) =>
    all || layout === undefined
      ? allWindowsLines(windows, tasks).join("\n")
      : [
          ...groupLines(layout, { tasks }),
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
  const answer = await ask({ kind: "list" }, ctx);
  const own = answer?.read?.layout;
  const place = own === undefined ? undefined : tabPlace(own, tabId);
  if (place !== undefined) {
    return place;
  }
  const layout = (answer?.windows ?? [])
    .flatMap((window) => window.groups)
    .find((each) =>
      each.sides.some((side) => side.tabs.some((tab) => tab.id === tabId)),
    );
  const there = layout === undefined ? undefined : tabPlace(layout, tabId);
  return layout === undefined || there === undefined
    ? undefined
    : `in the tab group ${groupWords(layout)}, ${there}`;
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
  summary:
    "Close tabs, or a tab group whole by its id; the user can bring back from the closed list what was theirs, not an agent's tab they never used.",
  surfaces: {
    cli: { help: "", positional: ["tabs"], words: ["window", "close"] },
  },
  text: (outcomes) => outcomes.map((each) => each.said).join("\n"),
  where: CHATS,
});

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
    said: `Closed the tab group ${layout ? groupWords(layout) : group}${count === undefined ? "" : count === 1 ? ", its one tab" : `, its ${count} tabs`}.${answer?.isListed === false ? "" : " The user can bring it back with Undo or from the closed list."}`,
    target: group,
  };
}

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
  summary:
    "Make a new tab group of tabs, moved out of their groups as Move to New Tab Group moves one, in the window the chat works in; the window stays on the group it shows. The sidebar titles a group by its tabs.",
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
    return `Moved ${ids.join(", ")} into the tab group ${groupWords(named.group)}.`;
  },
  summary:
    "Move tabs into an existing tab group, by its id or name, as dropping each on its row does; a group left with no tab closes.",
  surfaces: {
    cli: { help: "", positional: ["tabs"], words: ["window", "move"] },
  },
  text: (said) => said,
  where: CHATS,
});

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
    const answer = await ask({ entry, kind: "reopenClosed" }, ctx);
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    if (answer.error !== undefined) {
      throw new Error(answer.error);
    }
    const back =
      answer.group === undefined
        ? undefined
        : await groupById(answer.group, ctx);
    return `Restored ${entry}${back ? ` in the tab group ${groupWords(back)}` : ""}, as History's restore does.`;
  },
  summary:
    "Reopen a closed tab, side or tab group by its History id, exactly as History's restore does.",
  surfaces: {
    cli: { help: "", positional: ["entry"], words: ["window", "restore"] },
  },
  text: (said) => said,
  where: CHATS,
});
