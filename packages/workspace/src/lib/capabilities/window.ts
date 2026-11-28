import {
  chatAddressOf,
  filePathOfInstrumentLink,
  GROUP_NAME_MAX,
  groupAddressOf,
  instrumentLinkOf,
  isInstrumentAddress,
  plainGroupName,
} from "@instrument-org/shared";
import { z } from "zod";

import {
  type BrowserSite,
  BrowserSiteSchema,
} from "../../schemas/browser-site";
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
import { personPagesOn, SITE_HISTORY_LIMIT } from "../actions/read";
import { noteBrowserAgentActivity } from "../browser-agent-activity";
import { recordVisitedHosts } from "../browser-state";
import { ChatStateSchema, chatStateOf } from "../chat/chat-state";
import { listChats } from "../chat/chats";
import { recordAsk } from "../chat/asks";
import { askWindow, WINDOW_TAB_TIMEOUT_MS } from "../chat/window-tab";
import { isPersonsTurn } from "../chat/person-turn";
import {
  chatPageTabs,
  noteTabClosedByChat,
  pageTabNamed,
  tabHolders,
} from "../chat/chat-tabs";
import { noteTabCommand } from "../tab-activity";
import { agentPathOfFileUrl, isLocalAddress } from "../local-page-address";
import { recordRaisedAsk } from "../shell-commands/raised-asks";
import { recordWindowPicture } from "../shell-commands/window-pictures";
import { windowJustSentFrom } from "../chat/window-sends";
import { takeWindowPicture } from "../window-picture";
import {
  LOOKING_IS_THE_CHATS,
  NEW_WINDOW_IS_THE_USERS,
  WAITING_IS_THE_CHATS,
  WINDOW_COMMAND,
  WINDOW_IS_THE_CHATS,
} from "../../model-text/commands/window-command";
import { getWorkspaceConfig } from "../workspace-config";
import {
  type CapabilityContext,
  CapabilityFailure,
  defineCapability,
} from "./define";
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

/** Which task is at work in a tab, and the clause for the line that reports what happened to it. */
async function holderOf(tabId: string, ctx: CapabilityContext) {
  const holders = await tabHolders(ctx.chatId);
  // With a task at work in any tab, the tab by the id agents name it by,
  // where the agent named its page's, as earlier builds named a tab on an
  // HTML file, and the page it draws.
  const page =
    holders.size === 0
      ? undefined
      : pageTabNamed(await chatPageTabs(ctx.chatId), tabId);
  const id = page?.id ?? tabId;
  const holder = holders.get(id);
  return {
    clause: holder
      ? ` Task ${holder.id} ("${holder.title}") was working in it; its next browser command tells it so.`
      : "",
    id,
    session: holder?.session,
    targetId: page?.targetId ?? parseBrowserTargetId(tabId),
  };
}

/**
 * The tasks at work in tabs a move may take out of the chat's tab group,
 * read before the move, and after it the way to tell each task whose tab
 * left the group, where its agent-browser no longer reaches it: its next
 * browser command says so, as for a tab the chat closed. `tellHolders`
 * gives the clause for the line that reports each such tab, by its id.
 */
async function holdersOfMoved(ids: readonly string[], ctx: CapabilityContext) {
  const held = (
    await Promise.all(
      ids.map(async (id) => ({ holder: await holderOf(id, ctx), id })),
    )
  ).filter(({ holder }) => holder.session !== undefined);
  return {
    async tellHolders(): Promise<Map<string, string>> {
      const clauses = new Map<string, string>();
      if (held.length === 0) {
        return clauses;
      }
      const pages = await chatPageTabs(ctx.chatId);
      for (const { holder, id } of held) {
        if (
          pages === undefined ||
          holder.session === undefined ||
          holder.targetId === null ||
          pages.some((page) => page.id === holder.id)
        ) {
          continue;
        }
        await noteTabClosedByChat(
          ctx.chatId,
          {
            id: holder.id,
            session: holder.session,
            url:
              getWorkspaceConfig().browser.getTargetAddress(holder.targetId) ??
              "",
          },
          "movedOut",
        );
        clauses.set(id, holder.clause);
      }
      return clauses;
    },
  };
}

/** The holder clauses of tabs one line reports together, each naming its tab when there are several. */
function movedClauses(ids: readonly string[], clauses: Map<string, string>) {
  return ids
    .map((id) => {
      const clause = clauses.get(id);
      return clause === undefined
        ? ""
        : ids.length === 1
          ? clause
          : ` Tab ${id}:${clause}`;
    })
    .join("");
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

/** A group's name, or its title where it has none, and its address, as a result line names it. */
function groupWords(layout: ListedGroup): string {
  return `"${layout.name ?? layout.title}" ${groupAddressOf(layout.group.id)}`;
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
function noteOpenedPage(page: string | undefined) {
  const targetId = parseBrowserTargetId(page ?? "");
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
 * Whether a tab's page, by the page's id, is on a file of this computer the
 * chat's own tools could not read, which the window would otherwise read
 * for it.
 */
function showsFileOutside(
  page: string | undefined,
  ctx: CapabilityContext,
): boolean {
  const targetId = parseBrowserTargetId(page ?? "");
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
  /** The step of the task whose page a tab shows, by the tab's id, while it works. */
  steps: z.record(z.string(), z.string()),
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

/** The task a tab's address names, by its session. */
const TASK_ADDRESS = /^instrument:\/\/task\/([^/?#]+)/;

/** What the workspace knows of the chats, tasks and projects the windows' groups name. */
async function factsOf(
  windows: WindowGroups,
): Promise<Pick<ListFacts, "chats" | "projects" | "steps">> {
  const listed = await listChats();
  const chats = new Map(listed.map((chat) => [chatAddressOf(chat.id), chat]));
  const running = new Map<string, string>(
    listed.flatMap((chat) =>
      chat.runningTasks.map(({ id, step = "" }) => [id, step]),
    ),
  );
  const tabs = windows
    .flatMap((window) => window.groups)
    .flatMap((group) => group.sides)
    .flatMap((side) => side.tabs);
  return {
    chats: Object.fromEntries(
      tabs.flatMap((tab) => {
        const chat = tab.kind === "chat" ? chats.get(tab.address) : undefined;
        return chat === undefined ? [] : [[tab.id, chatStateOf(chat)]];
      }),
    ),
    projects: Object.fromEntries(
      (await projectsInUse()).map((project) => [project.id, project.name]),
    ),
    steps: Object.fromEntries(
      tabs.flatMap((tab) => {
        const step = running.get(TASK_ADDRESS.exec(tab.address)?.[1] ?? "");
        return step === undefined ? [] : [[tab.id, step]];
      }),
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
      layout: listed ?? { ...own, title: own.group.id },
      ...facts,
      windows,
    };
  },
  summary:
    "A tab group's sides and tabs, one line each, by default the group the chat works in: the group's title, the name it was given where it has one, its address, whether it is pinned, its project, whether it is on screen and when it was last brought up (absent when not known), each tab's id (which every other subcommand and `agent-browser tab` take), where it stands, what it has open and the address a reply links it by, which task is at work in it, whether an agent opened it, words in a new tab not sent yet, whether a page uses the microphone or camera or can't connect, the step of a task's page or that its task stopped, and whether its chat is working, waiting on the user or unread, its latest line and when it was last active; then what the user sees, and the other groups there are. A group is named by its id, its name or its title; --all lists every window's groups, the pinned first.",
  surfaces: {
    cli: { help: "", positional: ["group"], words: ["window", "list"] },
    script: { positional: ["group"] },
  },
  text: ({ all, layout, windows, ...facts }) =>
    all || layout === undefined
      ? allWindowsLines(windows, facts).join("\n")
      : [
          ...groupLines(layout, { facts }),
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
    // another file while the window reads it, by the page the tab draws,
    // which for a tab on an HTML file is not the tab's id.
    if (showsFileOutside(tab, ctx)) {
      throw new Error(outsideFile(tab));
    }
    const page = pageTabNamed(await chatPageTabs(ctx.chatId), tab);
    if (page !== undefined && showsFileOutside(page.targetId, ctx)) {
      throw new Error(outsideFile(page.id));
    }
    const answer = await ask({ kind: "read", tabId: tab }, ctx);
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    if (answer.error) {
      throw new Error(answer.error);
    }
    if (showsFileOutside(answer.targetId ?? tab, ctx)) {
      throw new Error(outsideFile(answer.tabId ?? tab));
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

/** Why a look is refused outside a turn the person's own message started. */
const NOT_JUST_ASKED =
  "you can look at the user's window only while answering a message they just sent from it. Ask them what they see.";

const NO_SIGHT = `the model you run on can't see pictures. \`${NAME} list\` says what is open, and \`${NAME} read <id>\` prints a page's text.`;

export const windowLook = defineCapability({
  // Before anything is drawn: a turn something other than the person woke,
  // or one still going long after they asked, sees nothing.
  async gate(_input, ctx) {
    const window = await windowJustSentFrom(ctx);
    if (window === undefined) {
      return { kind: "refused", message: NOT_JUST_ASKED };
    }
    return (await ctx.callingModel()).features.includes("inputImage")
      ? { kind: "allowed" }
      : { kind: "refused", message: NO_SIGHT };
  },
  input: z.object({}),
  name: "window.look",
  output: z.object({
    hidden: z.array(z.object({ tab: z.string().optional(), why: z.string() })),
  }),
  async run(_input, ctx) {
    const window = await windowJustSentFrom(ctx);
    if (window === undefined) {
      throw new Error(NOT_JUST_ASKED);
    }
    const picture = await takeWindowPicture({
      askedBy: ctx.chatId,
      layout: ctx.layout,
      window,
    });
    if ("error" in picture) {
      throw new Error(picture.error);
    }
    recordWindowPicture(picture.png);
    return { hidden: picture.hidden };
  },
  summary:
    "Shows you the user's window as it looks now, in a picture with this call's result, what you can't read in it left gray; only while you answer a message they just sent.",
  surfaces: { cli: { help: "", words: ["window", "look"] } },
  text: ({ hidden }) =>
    [
      "The user's window as it looks now is in the picture with this result.",
      ...(hidden.length === 0
        ? []
        : [
            `Gray in it, and not for you to see: ${hidden
              .map(({ tab, why }) =>
                tab === undefined ? why : `${tab} (${why})`,
              )
              .join("; ")}. Say you can't see it rather than guess at it.`,
          ]),
    ].join("\n"),
  where: {
    roleRefusal: LOOKING_IS_THE_CHATS,
    roles: ["chat"],
  },
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
      return noteShownPages([await replace(into, targets, ctx)], ctx);
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
    return noteShownPages(outcomes, ctx);
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

/**
 * Each web page shown is one the session has been on, as a page an
 * agent-browser command reaches is: `connect_app` records a web app the
 * agent saw signed in only on a site the chat has been on, and a page shown
 * here is read with `read`.
 */
async function noteShownPages(
  outcomes: Outcome[],
  ctx: CapabilityContext,
): Promise<Outcome[]> {
  const urls = outcomes
    .filter((each) => !each.failed && /^https?:\/\//i.test(each.target))
    .map((each) => each.target);
  if (urls.length > 0) {
    const noted = await recordVisitedHosts({
      chatId: ctx.chatId,
      sessionId: ctx.sessionId,
      urls,
    });
    if (noted.isErr()) {
      getWorkspaceConfig().captureException(noted.error);
    }
  }
  return outcomes;
}

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
    // By the id agents name the tab by, where the agent named its page's.
    const shown = answer?.tabId ?? arg;
    return error === undefined
      ? {
          failed: false,
          said: `Tab ${shown}: ${(await placeOf(shown, ctx)) ?? "showing on its side"}.`,
          tab: shown,
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
  noteOpenedPage(answer?.targetId ?? tabId);
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
  const holder = await holderOf(tabId, ctx);
  const answer = await ask({ kind: "replace", tabId, target }, ctx);
  const error = answer ? answer.error : NO_WINDOW;
  if (error !== undefined) {
    return { failed: true, said: error, target: arg };
  }
  // The chat's act in the tab, which the task's next command there reports,
  // on the page drawing it now, which the window names when the tab shows
  // a page.
  const page = parseBrowserTargetId(answer?.targetId ?? "") ?? holder.targetId;
  if (holder.session !== undefined && page !== null) {
    noteTabCommand(
      { tabId: holder.id, targetId: page },
      { chatId: ctx.chatId, sessionId: ctx.sessionId },
    );
  }
  // The window answers with the id agents name the tab by, which is the one
  // to use next where the agent named it by its page's id.
  const now = answer?.tabId ?? tabId;
  const place = await placeOf(now, ctx);
  return {
    failed: false,
    said: `Tab ${tabId} now shows ${describeTarget(target)}${now !== tabId ? `, as tab ${now}` : ""}${place ? `: ${place}` : ""}.${holder.clause}`,
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
      const holder = await holderOf(tabId, ctx);
      const windows = await windowsOf(ctx);
      // A tab named by its page's id, as earlier builds named a tab on an
      // HTML file, is on its side under the tab's own.
      const side =
        sideOf(windows, holder.id) ??
        sideOf(
          windows,
          pageTabNamed(await chatPageTabs(ctx.chatId), tabId)?.id ?? tabId,
        );
      const url =
        holder.targetId === null
          ? undefined
          : getWorkspaceConfig().browser.getTargetAddress(holder.targetId);
      const answer = await ask({ kind: "close", tabId }, ctx);
      const error = answer ? answer.error : NO_WINDOW;
      if (
        error === undefined &&
        holder.session !== undefined &&
        holder.targetId !== null
      ) {
        await noteTabClosedByChat(ctx.chatId, {
          id: holder.id,
          session: holder.session,
          url: url ?? "",
        });
      }
      const closed = answer?.tabId ?? tabId;
      outcomes.push(
        error === undefined
          ? {
              failed: false,
              said: `Closed tab ${closed}.${side ? await closedSideLine(side, ctx) : ""}${holder.clause}`,
              tab: closed,
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

/**
 * Steps a tab back or forward as its Back and Forward buttons do, saying
 * what it shows then: its page's own history first, then the pages and
 * screens it showed.
 */
async function stepTab(
  tabId: string,
  direction: "back" | "forward",
  ctx: CapabilityContext,
): Promise<string> {
  const answer = await ask({ direction, kind: "step", tabId }, ctx);
  if (!answer) {
    throw new Error(NO_WINDOW);
  }
  if (answer.error !== undefined) {
    throw new Error(answer.error);
  }
  const now = answer.tabId ?? tabId;
  const as = now === tabId ? "" : `, as tab ${now}`;
  if (answer.stepped === "page") {
    return `Tab ${tabId} went ${direction} a page in its own history${as}; \`${NAME} list\` says where it landed once it loads.`;
  }
  const tab = (await windowsOf(ctx))
    .flatMap((window) => window.groups)
    .flatMap((layout) => layout.sides.flatMap((side) => side.tabs))
    .find((each) => each.id === now);
  const place = await placeOf(now, ctx);
  return `Tab ${tabId} went ${direction}${as}${tab ? `, to ${layoutTabName(tab)}` : ""}${place ? `: ${place}` : ""}.`;
}

const STEP_FORM = "<id>";

export const windowBack = defineCapability({
  input: z.object({ tab: TabField("back", STEP_FORM) }),
  name: "window.back",
  output: z.string(),
  run: ({ tab }, ctx) => stepTab(idOf(tab), "back", ctx),
  summary:
    "Take a tab back, as its Back button does: through its page's own history, then to the page or screen it showed before.",
  surfaces: {
    cli: { help: "", positional: ["tab"], words: ["window", "back"] },
  },
  text: (said) => said,
  where: CHATS,
});

export const windowForward = defineCapability({
  input: z.object({ tab: TabField("forward", STEP_FORM) }),
  name: "window.forward",
  output: z.string(),
  run: ({ tab }, ctx) => stepTab(idOf(tab), "forward", ctx),
  summary: "Take a tab forward, as its Forward button does.",
  surfaces: {
    cli: { help: "", positional: ["tab"], words: ["window", "forward"] },
  },
  text: (said) => said,
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
    // By the id agents name the tab by, or its page's, which earlier builds
    // named a tab on an HTML file by.
    const page =
      own.pages?.find((each) => each.id === tab) ??
      own.pages?.find((each) => each.targetId === tab);
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
    const shown = await ask({ kind: "show", tabId: page.id }, ctx);
    const failed = shown ? shown.error : NO_WINDOW;
    if (failed !== undefined) {
      throw new Error(
        `tab ${page.id} could not be shown, so no card was raised: ${failed}`,
      );
    }
    const place = await placeOf(page.id, ctx);
    const askId = await recordAsk(
      { ...ctx.asker, reason: reason.trim(), title: title.trim() },
      "page",
      page.id,
      { page: { title: page.title, url: page.url } },
    );
    recordRaisedAsk(askId);
    return `Showed the user tab ${page.id} ("${page.title || page.url}") with a card ${ABOVE_REPLY_BOX} titled "${title.trim()}", your reason, ${WAIT_CARD_WORDS.done} and ${WAIT_CARD_WORDS.skip}.${place ? ` Tab ${page.id}: ${place}.` : ""} Your turn ends here; their answer wakes you.`;
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
    const holders = await holdersOfMoved(ids, ctx);
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
    const clauses = await holders.tellHolders();
    return `Made the tab group ${words} of ${ids.join(", ")}; ${shown}.${movedClauses(ids, clauses)}`;
  },
  summary: `Make a new tab group of tabs, moved out of their groups as ${MOVE_TO_NEW_TAB_GROUP} moves one, in the window the chat works in; the window stays on the group it shows. The sidebar titles a group by its tabs.`,
  surfaces: {
    cli: { help: "", positional: ["tabs"], words: ["window", "group"] },
  },
  text: (said) => said,
  where: CHATS,
});

const MOVE_FORM = "<tab id>... --group <group>";

export const windowMove = defineCapability({
  input: z.object({
    tabs: TabsField("move", MOVE_FORM),
    group: z.string().optional().meta({
      description:
        "The tab group to move them into, by its id or name; without it, they stay in theirs, or go into that of the tab they are put beside.",
    }),
    side: z.enum(["left", "right"]).optional().meta({
      description:
        "The side to put them on, beside what stays on the other; a group of one side is split.",
    }),
    before: z.string().optional().meta({
      description: "The tab they go just before in its strip, in order.",
    }),
    after: z.string().optional().meta({
      description: "The tab they go just after in its strip, in order.",
    }),
  }),
  name: "window.move",
  output: z.string(),
  async run({ after, before, group, side, tabs }, ctx) {
    const placed = [side, before, after].filter((each) => each !== undefined);
    if (placed.length > 1) {
      throw new Error(
        "move takes one of --side, --before and --after; a tab is put on the side of the tab it goes beside.",
      );
    }
    if (group === undefined && placed.length === 0) {
      throw new Error(
        `move needs the group to move them into (${NAME} move ${MOVE_FORM}), or --side, --before or --after.`,
      );
    }
    const named =
      group === undefined
        ? undefined
        : groupNamed(await windowsOf(ctx), idOf(group));
    if (named && "error" in named) {
      throw new Error(named.error);
    }
    const ids = tabs.map(idOf);
    const holders = await holdersOfMoved(ids, ctx);
    const anchor = before ?? after;
    const answer = await ask(
      {
        kind: "moveTabs",
        tabIds: ids,
        ...(named === undefined ? {} : { group: named.group.group.id }),
        ...(side === undefined ? {} : { side }),
        ...(anchor === undefined
          ? {}
          : {
              place: {
                anchor: idOf(anchor),
                where:
                  before === undefined
                    ? ("after" as const)
                    : ("before" as const),
              },
            }),
      },
      ctx,
    );
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    if (answer.error !== undefined) {
      throw new Error(answer.error);
    }
    const clauses = await holders.tellHolders();
    if (named !== undefined && placed.length === 0) {
      const into = await groupById(named.group.group.id, ctx);
      return `Moved ${ids.join(", ")} into the tab group ${groupWords(named.group)}${into ? `; ${sightOf(into)}` : ""}.${movedClauses(ids, clauses)}`;
    }
    const lines: string[] = [];
    for (const id of ids) {
      const place = await placeOf(id, ctx);
      lines.push(
        `Moved ${id}${place ? `: ${place}` : ""}.${clauses.get(id) ?? ""}`,
      );
    }
    return lines.join("\n");
  },
  summary:
    "Move tabs: into an existing tab group, by its id or name, as dropping each on its row does; with --side, onto its left or right side, beside what stays on the other, as Move to Other Side does; with --before or --after, beside a tab in its strip, in order, as dragging does. Where the user has the keyboard stays. A group left with no tab closes, or, pinned, gets a new tab.",
  surfaces: {
    cli: { help: "", positional: ["tabs"], words: ["window", "move"] },
  },
  text: (said) => said,
  where: CHATS,
});

export const windowJoin = defineCapability({
  input: z.object({
    group: z.string().optional().meta({
      description:
        "A tab group's id or name; by default the group of the chat's tab the person last sent from.",
    }),
  }),
  name: "window.join",
  output: z.string(),
  async run({ group }, ctx) {
    const list = await ask({ kind: "list" }, ctx);
    if (!list) {
      throw new Error(NO_WINDOW);
    }
    const own = list.read?.layout;
    // As its window lists it, which names it as its sidebar row does.
    const listed =
      own &&
      (list.windows ?? [])
        .flatMap((window) => window.groups)
        .find((each) => each.group.id === own.group.id);
    const named =
      group === undefined
        ? own && { group: listed ?? { ...own, title: own.group.id } }
        : groupNamed(list.windows ?? [], idOf(group));
    if (named === undefined) {
      throw new Error(
        `this chat has no tab in any group. \`${NAME} list --all\` lists every group.`,
      );
    }
    if ("error" in named) {
      throw new Error(named.error);
    }
    const answer = await ask(
      { group: named.group.group.id, kind: "joinSides" },
      ctx,
    );
    const error = answer ? answer.error : NO_WINDOW;
    if (error !== undefined) {
      throw new Error(error);
    }
    const joined = await groupById(named.group.group.id, ctx);
    return `Joined the sides of the tab group ${groupWords(named.group)}.${joined ? ` ${showingLine(joined)}` : ""}`;
  },
  summary:
    "Make a split tab group's two sides one, as Join Sides does: the right side's tabs after the left's, the tab the user has the keyboard in still showing.",
  surfaces: {
    cli: { help: "", positional: ["group"], words: ["window", "join"] },
  },
  text: (said) => said,
  where: CHATS,
});

export const windowNew = defineCapability({
  input: z.object({
    targets: z
      .array(z.string(), {
        error: `new needs a tab group or the ids of tabs (${NAME} new <group>).`,
      })
      .min(
        1,
        `new needs a tab group or the ids of tabs (${NAME} new <group>).`,
      ),
  }),
  name: "window.new",
  output: z.string(),
  async run({ targets }, ctx) {
    if (!(await isPersonsTurn(ctx.chatId, ctx.sessionId))) {
      throw new CapabilityFailure(NEW_WINDOW_IS_THE_USERS, "refused");
    }
    const ids = targets.map(idOf);
    const tabs = ids.filter(isTabId);
    let group: string | undefined;
    if (tabs.length < ids.length) {
      const named = ids.length === 1 ? ids[0] : undefined;
      if (named === undefined) {
        throw new Error("new takes one tab group, or tabs by their ids.");
      }
      const found = groupNamed(await windowsOf(ctx), named);
      if ("error" in found) {
        throw new Error(found.error);
      }
      group = found.group.group.id;
    }
    const answer = await ask(
      {
        kind: "newWindow",
        tabIds: tabs,
        ...(group === undefined ? {} : { group }),
      },
      ctx,
    );
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    if (answer.error !== undefined || answer.group === undefined) {
      throw new Error(answer.error ?? NO_WINDOW);
    }
    return `Opened a new window on the tab group ${groupAddressOf(answer.group)}.`;
  },
  summary:
    "Put a tab group, by id or name, or tabs, by their ids, in a new window, as Open in New Window does. Only when the message you are answering asks for a new window; refused in a turn the user did not start.",
  surfaces: {
    cli: { help: "", positional: ["targets"], words: ["window", "new"] },
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

export const windowName = defineCapability({
  input: z.object({
    group: z.string({
      error: `name needs a tab group: ${NAME} name <group> '<name>'.`,
    }),
    name: z.string().optional().meta({
      description:
        "What the group's work is for, in the user's words ('Best running shoes'), never what a tab already shows (a site, a file's name).",
    }),
    clear: z.boolean().default(false).meta({
      description: "Take the group's name off.",
    }),
  }),
  name: "window.name",
  output: z.string(),
  async run({ clear, group, name }, ctx) {
    if (clear === (name !== undefined)) {
      throw new Error(
        `name takes a name or --clear: ${NAME} name <group> '<name>', or ${NAME} name <group> --clear.`,
      );
    }
    const plain = name === undefined ? undefined : plainGroupName(name);
    if (name !== undefined && plain === undefined) {
      throw new Error(
        `a tab group's name is a few words, at most ${GROUP_NAME_MAX} characters.`,
      );
    }
    const named = groupNamed(await windowsOf(ctx), idOf(group));
    if ("error" in named) {
      throw new Error(named.error);
    }
    const words = groupWords(named.group);
    const answer = await ask(
      {
        group: named.group.group.id,
        kind: "nameGroup",
        ...(plain === undefined ? {} : { name: plain }),
      },
      ctx,
    );
    if (!answer) {
      throw new Error(NO_WINDOW);
    }
    if (answer.error !== undefined) {
      throw new Error(answer.error);
    }
    return plain === undefined
      ? `Took the name off the tab group ${words}.`
      : `Named the tab group ${words} "${plain}"; a link or \`--group\` that names "${plain}" opens into it.`;
  },
  summary:
    "Name a tab group, by id or name, for what its work is for, shown under its row's title, as Name Tab Group does; --clear takes the name off.",
  surfaces: {
    cli: {
      help: "",
      positional: ["group", "name"],
      words: ["window", "name"],
    },
  },
  text: (said) => said,
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

const HistoryRowSchema = z.object({
  address: z.string().optional(),
  at: z.number(),
  context: z.string(),
  id: z.string(),
  kind: z.enum(["closedGroup", "closedSide", "closedTab", "visit"]),
  title: z.string(),
});

type HistoryRow = z.output<typeof HistoryRowSchema>;

/** A site as `--site` names it: a host, or an address's host, without `www.`. */
function siteNamed(named: string): string {
  const host = /^https?:\/\//i.test(named)
    ? (URL.parse(named)?.hostname ?? named)
    : named;
  return host
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

/** The pages the user visited on a site, as History's rows: by title, the host as context. */
function siteRows(site: string, limit: number): HistoryRow[] {
  return personPagesOn(site, limit).map((page) => ({
    address: page.url,
    at: Date.parse(page.at),
    context: URL.parse(page.url)?.hostname.replace(/^www\./, "") ?? page.url,
    id: page.at,
    kind: "visit",
    title: page.title || page.url.replace(/^https?:\/\//, ""),
  }));
}

function historyText(rows: readonly HistoryRow[]): string {
  return rows.length === 0
    ? "Nothing in History yet."
    : rows
        .map(
          (row) =>
            `${row.kind === "visit" ? "" : `${row.id}  `}${new Date(row.at).toISOString()}  ${HISTORY_WORDS[row.kind]}: ${row.title}${row.context === "" ? "" : ` (${row.context})`}${row.address === undefined ? "" : `  ${row.address}`}`,
        )
        .join("\n");
}

export const windowHistory = defineCapability({
  input: z.object({
    closed: z.boolean().default(false).meta({
      description: "Only the tabs, sides and tab groups closed.",
    }),
    limit: z.number().int().min(1).default(HISTORY_LIMIT).meta({
      description: "How many rows, newest first.",
    }),
    site: z
      .string()
      .optional()
      .meta({
        description: `Only the pages visited on this site and on every host under it, among History's newest ${SITE_HISTORY_LIMIT.toString()}.`,
      }),
  }),
  name: "window.history",
  output: z.array(HistoryRowSchema),
  render: (rows, { site }) => ({
    stdout: `${rows.length === 0 && site !== undefined ? `No page on ${siteNamed(site)} in History.` : historyText(rows)}\n`,
  }),
  async run({ closed, limit, site }, ctx) {
    if (site !== undefined) {
      if (closed) {
        throw new Error(
          `history takes --closed or --site, not both: ${NAME} history --site <site>.`,
        );
      }
      return siteRows(siteNamed(site), limit);
    }
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
    "The window's History, newest first, as its History list shows it: the tabs, sides and tab groups closed, each by the id `restore` takes, and the places visited. --closed lists only what was closed; --site <site> only the pages the user visited on a site and every host under it.",
  surfaces: {
    cli: { help: "", words: ["window", "history"] },
  },
  text: historyText,
});

/** The words a time is printed in: to the minute, in UTC. */
function minuteOf(at: number): string {
  return `${new Date(at).toISOString().slice(0, 16)}Z`;
}

/** Whether a site was used rather than only setting cookies from other sites' pages: a page on it visited, or data kept. */
function isUsed(site: BrowserSite): boolean {
  return site.visits.user + site.visits.agent > 0 || site.siteData.length > 0;
}

const SitesSchema = z.object({
  /** How many sites only set cookies from other sites' pages, which only `--all` lists. */
  cookieOnly: z.number().int(),
  sites: z.array(BrowserSiteSchema),
});

const COOKIE_IS_NO_SIGN_IN =
  "A cookie is not a sign-in: open a site to see whether it is signed in.";

function sitesText({
  cookieOnly,
  sites,
}: z.output<typeof SitesSchema>): string {
  const count = cookieOnly.toString();
  const noun = cookieOnly === 1 ? "site" : "sites";
  if (sites.length === 0) {
    return cookieOnly === 0
      ? "The in-app browser has no cookies, site data or visits yet."
      : `No site was visited or keeps site data; ${count} ${noun} only set cookies from other sites' pages, which \`${NAME} sites --all\` lists.`;
  }
  const cells = [
    [
      "site",
      "cookies",
      "last used",
      "visits user/agent",
      "site data",
      "set up as",
    ],
    ...sites.map((site) => [
      site.site,
      site.cookies.toString(),
      site.usedAt === undefined ? "-" : minuteOf(site.usedAt),
      `${site.visits.user.toString()}/${site.visits.agent.toString()}`,
      site.siteData.length === 0 ? "-" : site.siteData.join(", "),
      site.setUpAs.join(", "),
    ]),
  ];
  const last = (cells[0]?.length ?? 1) - 1;
  const widths = Array.from({ length: last }, (_, column) =>
    Math.max(...cells.map((row) => (row[column] ?? "").length)),
  );
  return [
    ...(cookieOnly === 0
      ? []
      : [
          `${count} more ${noun} only set cookies from other sites' pages; \`${NAME} sites --all\` lists them.`,
        ]),
    COOKIE_IS_NO_SIGN_IN,
    ...cells.map((row) =>
      row
        .map((cell, column) =>
          column === last ? cell : cell.padEnd(widths[column] ?? 0),
        )
        .join("  ")
        .trimEnd(),
    ),
  ].join("\n");
}

export const windowSites = defineCapability({
  input: z.object({
    all: z.boolean().default(false).meta({
      description:
        "Every site with cookies, those set only from other sites' pages too.",
    }),
  }),
  name: "window.sites",
  output: SitesSchema,
  async run({ all }) {
    const read = getWorkspaceConfig().readBrowserSites;
    if (!read) {
      throw new Error("there is no in-app browser here to read.");
    }
    const sites = (await read()).toSorted(
      (a, b) =>
        (b.usedAt ?? 0) - (a.usedAt ?? 0) || a.site.localeCompare(b.site),
    );
    const shown = all ? sites : sites.filter(isUsed);
    return { cookieOnly: sites.length - shown.length, sites: shown };
  },
  summary:
    "The sites the in-app browser has cookies or site data for, most recently used first: each one's cookies, when it was last used, its pages visited by the user and by agents, the data it keeps (IndexedDB, Local Storage) and the apps set up on it. Only those visited or keeping data; --all adds the ones that only set cookies from other sites' pages.",
  surfaces: {
    cli: { help: "", words: ["window", "sites"] },
  },
  text: sitesText,
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
