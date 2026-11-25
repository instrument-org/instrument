import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publisher } from "../../rpc/publisher";
import { ChatIdSchema, type ChatId } from "../../schemas/chat-id";
import { WorkDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type LayoutSnapshot } from "../../schemas/group-layout";
import { type WindowTabAction } from "../../schemas/window-tab";
import { type Chat } from "../chat/chats";
import { type Project } from "../chat/projects";
import { tabStanding } from "../capabilities/window";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { buildWorkspaceFsLayout } from "../workspace-fs-layout";
import { createWindowCommand } from "./window";

const chatId = ChatIdSchema.parse("window-command-chat");
// As this computer spells it, with a drive on Windows, where the browser's
// addresses carry one.
const chatFolder = path.resolve("/work/chats/window-command-chat");
const layout = buildWorkspaceFsLayout({
  chatHostRoot: WorkDirSchema.parse(chatFolder),
});

// A page tab, by its id, and the
// addresses the browser reports it showing, one per ask, the last repeating.
// What a list reads of a chat, the rest of it unused here.
const CHAT_FACTS = {
  archived: false,
  latest: { kind: "question" as const, text: "Which **one**\nfirst?" },
  runningTasks: [
    {
      id: StoreId.SessionSchema.parse("ses_01ARZ3NDEKTSV4RRFFQ69G5FAV"),
      step: "Reading the menu",
      title: "Read the menu",
    },
  ],
  starred: false,
  status: "waiting" as const,
  unread: true,
  updatedAt: Date.UTC(2026, 10, 23),
  working: true,
};

const pageTab = StoreId.newTabId();
let pageUrls: string[];

// Which task is at work in which tab, as the chat's tasks' records would say.
const holders = new Map<
  string,
  { id: string; session: StoreId.Session; title: string }
>();
// How long a call waits on the window, short where a test has none answer.
let windowTimeoutMs = 2000;
vi.mock(import("../chat/chat-tabs"), async (importOriginal) => ({
  ...(await importOriginal()),
  tabHolders: () => Promise.resolve(holders),
}));
// The chat a tab in another group shows, and the project a group is in.
vi.mock(import("../chat/chats"), async (importOriginal) => ({
  ...(await importOriginal()),
  listChats: () =>
    Promise.resolve([
      {
        ...CHAT_FACTS,
        id: ChatIdSchema.parse("notes"),
      } as Chat,
    ]),
}));
vi.mock(import("../capabilities/projects"), async (importOriginal) => ({
  ...(await importOriginal()),
  projectsInUse: () =>
    Promise.resolve([{ id: "project_launch", name: "Launch" } as Project]),
}));
vi.mock(import("../chat/window-tab"), async (importOriginal) => ({
  ...(await importOriginal()),
  get WINDOW_TAB_TIMEOUT_MS() {
    return windowTimeoutMs;
  },
}));

// The cards a command raised, as the chat's state would keep them.
const raised: unknown[][] = [];
vi.mock(import("../chat/asks"), async (importOriginal) => ({
  ...(await importOriginal()),
  recordAsk: (...args: unknown[]) => {
    raised.push(args);
    return Promise.resolve("ask-1");
  },
}));

// A tab of the user's own, outside the chat, which a note named.

/** The window's other groups: one of a tab, behind the chat's, and a split one. */
const OTHER_GROUPS = [
  {
    focused: 0 as const,
    group: { id: "group:docs" },
    name: "report.md",
    isShown: false,
    drafts: { tab_new: "Ask about rent" },
    pinned: true,
    project: "project_launch",
    shownAt: Date.UTC(2026, 10, 24, 9, 12),
    sides: [
      {
        tabs: [
          {
            address: "/Users/me/Instrument/report.md",
            id: "tab_docs",
            isUp: true,
            kind: "file" as const,
            title: "report.md",
          },
          {
            address: "instrument://screen/settings",
            id: "tab_settings",
            kind: "builtIn" as const,
            title: "Settings",
          },
          {
            address: "instrument://new-chat",
            id: "tab_new",
            kind: "newChat" as const,
            title: "New Tab",
          },
          {
            address:
              "instrument://task/ses_01ARZ3NDEKTSV4RRFFQ69G5FAV?chat=notes",
            id: "tab_task",
            kind: "builtIn" as const,
            title: "Read the menu",
          },
        ],
      },
    ],
  },
  {
    focused: 0 as const,
    group: { id: "group:notes" },
    name: "Meeting notes",
    isShown: false,
    marks: {
      tab_ex: { failed: true as const },
      tab_hn: { using: { camera: true, microphone: true, paused: false } },
    },
    sides: [
      {
        tabs: [
          {
            address: "instrument://chat/notes",
            id: "tab_notes",
            isUp: true,
            kind: "chat" as const,
            title: "Meeting notes",
          },
        ],
      },
      {
        tabs: [
          {
            address: "https://news.ycombinator.com/",
            id: "tab_hn",
            isUp: true,
            kind: "website" as const,
            title: "Hacker News",
          },
          {
            address: "https://example.com/",
            byAgent: true,
            id: "tab_ex",
            kind: "website" as const,
            title: "Example",
          },
        ],
      },
    ],
  },
];

/** History as the window lists it, newest first. */
const HISTORY = [
  {
    at: Date.UTC(2026, 10, 15, 9, 30),
    context: "3 tabs",
    id: "tab_closed1",
    kind: "closedGroup" as const,
    title: "Trip planning",
  },
  {
    address: "https://example.com/",
    at: Date.UTC(2026, 10, 15, 9, 20),
    context: "example.com",
    id: "2026-11-15T09:20:00.000Z#0",
    kind: "visit" as const,
    title: "Example Domain",
  },
];

/** The one group another window has open, which it shows. */
const ELSEWHERE = {
  focused: 0 as const,
  group: { id: "group:far" },
  name: "report.md",
  sides: [
    {
      tabs: [
        {
          address: "https://example.org/",
          id: "tab_far",
          isUp: true,
          kind: "website" as const,
          title: "report.md",
        },
      ],
    },
  ],
};

let asked: { action: WindowTabAction; chatId?: ChatId }[];
/** Tabs the window refuses to show. */
const refusedShows = new Set<string>();
let stopAnswering: () => void;

/** Whether the turn is the person's (`isPersonsTurn`). */
let personsTurn = true;
vi.mock(import("../chat/person-turn"), () => ({
  isPersonsTurn: () => Promise.resolve(personsTurn),
}));

/**
 * A window with two tabs open, `tab_known` and a page in front: answers each
 * ask the way the window does, with a new tab for an open and an error for
 * an id it has not got.
 */
function answeringWindow() {
  const known = new Set<string>(["tab_known", pageTab, "tab_docs", "tab_hn"]);
  const groups = new Set<string>([
    "group_a",
    "group:docs",
    "group:notes",
    "group:far",
  ]);
  /** What each open made, which the right side then shows, as the window puts a page the chat shows beside it. */
  const made: string[] = [];
  /** The tabs closed, which a list leaves out, as the window does. */
  const closed = new Set<string>();
  /** A group as the window lists it once the closed tabs are gone: the next tab on a side comes up, and a side or group left empty goes. */
  const open = <T extends LayoutSnapshot>(group: T): T => ({
    ...group,
    sides: group.sides.flatMap((side) => {
      const tabs = side.tabs.filter((tab) => !closed.has(tab.id));
      const [first, ...rest] = tabs;
      if (first === undefined) {
        return [];
      }
      return [
        {
          ...side,
          tabs: tabs.some((tab) => tab.isUp)
            ? tabs
            : [{ ...first, isUp: true }, ...rest],
        },
      ];
    }),
  });
  return publisher.subscribe("window.tab", (ask) => {
    asked.push({
      action: ask.action,
      ...(ask.chatId ? { chatId: ask.chatId } : {}),
    });
    const { action } = ask;
    if (action.kind === "close" && known.has(action.tabId)) {
      closed.add(action.tabId);
    }
    if (action.kind === "reopenClosed") {
      // A tab back for a closed tab, two for a closed side.
      made.push(
        ...({ tab_closed1: ["tab_back"], tab_closed2: ["tab_b1", "tab_b2"] }[
          action.entry
        ] ?? []),
      );
    }
    const own = {
      focused: 1 as const,
      group: { id: "group_a" },
      name: "Prices",
      sides: [
        {
          tabs: [
            {
              address: "instrument://chat/this",
              id: "tab_known",
              isThisChat: true,
              isUp: true,
              kind: "chat" as const,
              title: "Prices",
            },
          ],
        },
        {
          tabs: [
            {
              address: "https://www.zendesk.com/pricing/",
              id: pageTab,
              ...(made.length === 0 && { isUp: true }),
              kind: "website" as const,
              title: "Suite plans",
            },
            ...made.map((id, index) => ({
              address: "https://example.com/",
              id,
              ...(index === made.length - 1 && { isUp: true }),
              kind: "website" as const,
              title: "Example",
            })),
          ],
        },
      ],
    };
    const answer =
      action.kind === "open"
        ? { tabId: `made-${made.push(`made-${made.length + 1}`)}` }
        : action.kind === "list"
          ? {
              pages: [
                {
                  id: pageTab,
                  title: "Suite plans",
                  url: "https://www.zendesk.com/pricing/",
                },
              ],
              read: { layout: open(own), movedIn: {}, movedOut: {} },
              windows: [
                {
                  groups: [own, ...OTHER_GROUPS]
                    .map(open)
                    .filter((group) => group.sides.length > 0),
                  isThisWindow: true,
                },
                { groups: [ELSEWHERE].map(open) },
              ],
            }
          : action.kind === "showGroup" ||
              action.kind === "closeGroup" ||
              action.kind === "joinSides" ||
              action.kind === "pinGroup" ||
              action.kind === "placeGroup"
            ? groups.has(action.group)
              ? action.kind === "closeGroup"
                ? // The docs group holds only tabs an agent opened.
                  { isListed: action.group !== "group:docs" }
                : {}
              : { error: `no tab group ${action.group} is open.` }
            : action.kind === "newWindow"
              ? { group: action.group ?? "group:new" }
              : action.kind === "moveTabs"
                ? action.group === undefined || groups.has(action.group)
                  ? {}
                  : { error: `no tab group ${action.group} is open.` }
                : action.kind === "groupTabs"
                  ? { group: "group:docs" }
                  : action.kind === "history"
                    ? { history: HISTORY.slice(0, action.limit) }
                    : action.kind === "reopenClosed"
                      ? action.entry === "tab_closed1" ||
                        action.entry === "tab_closed2"
                        ? {}
                        : { error: `nothing in History is ${action.entry}.` }
                      : action.kind === "handOver" ||
                          action.kind === "bookmarks" ||
                          action.kind === "addBookmark" ||
                          action.kind === "changeBookmarks"
                        ? {}
                        : action.kind === "show" &&
                            refusedShows.has(action.tabId)
                          ? {
                              error: `tab ${action.tabId} is in a window that is closing.`,
                            }
                          : known.has(action.tabId)
                            ? {
                                tabId: action.tabId,
                                ...(action.kind === "read"
                                  ? { text: "Jar\nA rigid container." }
                                  : {}),
                              }
                            : {
                                error: `no tab ${action.tabId} is open in this chat.`,
                              };
    publisher.publish("window.tabDone", {
      id: ask.id,
      requestId: ask.requestId,
      ...answer,
    });
  });
}

function run(
  options: {
    role?: "chat" | "task";
    sessionId?: StoreId.Session;
    timeoutMs?: number;
  },
  ...args: string[]
) {
  const fsTree = new InMemoryFs();
  fsTree.writeFileSync("/Users/me/Instrument/report.md", "# report");
  windowTimeoutMs = options.timeoutMs ?? 2000;
  return createWindowCommand({
    chatId,
    layout,
    role: options.role ?? "chat",
    sessionId: options.sessionId ?? StoreId.newSessionId(),
  }).execute(
    args,
    createCommandContext({
      cwd: layout.chat.shellRoot,
      env: new Map<string, string>(),
      fs: fsTree,
      stdin: EMPTY_BYTES,
    }),
  );
}

beforeEach(() => {
  asked = [];
  personsTurn = true;
  raised.length = 0;
  refusedShows.clear();
  holders.clear();
  pageUrls = [];
  const config = getWorkspaceConfig();
  setWorkspaceConfig({
    ...config,
    browser: {
      ...config.browser,
      getLoadedDocumentUrl: () =>
        pageUrls.length > 1 ? pageUrls.shift() : pageUrls[0],
    },
  });
  stopAnswering = answeringWindow();
});

afterEach(() => {
  stopAnswering();
});

describe("tabStanding", () => {
  it("reads where a tab stands, and whether the user sees it, changing nothing", async () => {
    const tabs = {
      page: pageTab,
      chat: "tab_known",
      otherGroup: "tab_settings",
      otherGroupUp: "tab_hn",
      otherWindow: "tab_far",
      gone: "tab_gone",
    };
    const standings = Object.fromEntries(
      await Promise.all(
        Object.entries(tabs).map(
          async ([name, tab]) =>
            [name, await tabStanding(chatId, tab)] as const,
        ),
      ),
    );
    expect(asked.every(({ action }) => action.kind === "list")).toBe(true);
    expect(standings).toMatchInlineSnapshot(`
      {
        "chat": {
          "place": "showing on your side, the left, covering this chat, which is hidden until the user switches back to it",
          "shown": true,
        },
        "gone": undefined,
        "otherGroup": {
          "place": "in the tab group "report.md" instrument://group/group:docs, hidden in the group's one side, behind /Users/me/Instrument/report.md, since the user is working on that side; the window shows another tab group now, so it is not on screen",
          "shown": false,
        },
        "otherGroupUp": {
          "place": "in the tab group "Meeting notes" instrument://group/group:notes, showing on the right side; the window shows another tab group now, so it is not on screen",
          "shown": false,
        },
        "otherWindow": {
          "place": "in the tab group "report.md" instrument://group/group:far, showing in the group's one side",
          "shown": true,
        },
        "page": {
          "place": "showing on the right side, beside you",
          "shown": true,
        },
      }
    `);
  });
});

describe("window show, for something new", () => {
  it("prints the tab the window made for each page, so a task can be handed it", async () => {
    const result = await run(
      {},
      "show",
      "https://example.com/",
      "https://example.org/",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "Opened https://example.com/ (tab made-1): showing on the right side, beside you.\nOpened https://example.org/ (tab made-2): showing on the right side, beside you.\n",
    );
    expect(asked.map(({ action }) => action)).toEqual([
      {
        kind: "open",
        show: true,
        target: { kind: "page", url: "https://example.com/" },
      },
      { kind: "list" },
      {
        kind: "open",
        show: true,
        target: { kind: "page", url: "https://example.org/" },
      },
      { kind: "list" },
    ]);
  });

  // A terminal's `open` stands you in a folder, and so does this one. The
  // slash is how the window is told which of the two it was handed.
  it("opens a folder, named with the slash that says it is one", async () => {
    const result = await run({}, "show", "/Users/me/Instrument");

    expect(result.stdout).toBe(
      "Opened /Users/me/Instrument/ (tab made-1): showing on the right side, beside you.\n",
    );
    expect(asked[0]?.action).toEqual({
      kind: "open",
      show: true,
      target: { kind: "path", path: "/Users/me/Instrument/" },
    });
  });

  it("refuses a path that does not exist, and opens the rest", async () => {
    const result = await run(
      {},
      "show",
      "/etc/hosts",
      "/Users/me/Instrument/report.md",
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('"/etc/hosts" does not exist');
    expect(result.stdout).toBe(
      "Opened /Users/me/Instrument/report.md (tab made-1): showing on the right side, beside you.\n",
    );
  });

  it.each([
    ["a chat", "instrument://chat/2026-11-14-make-this-red-6zks"],
    ["a part of Settings", "instrument://settings/providers"],
    ["a built-in page", "instrument://screen/chats"],
    ["an app", "instrument://app/notion"],
  ])("opens %s by the address window list prints", async (_label, address) => {
    const result = await run({}, "show", address);

    expect(result.exitCode).toBe(0);
    expect(asked[0]?.action).toEqual({
      kind: "open",
      show: true,
      target: { address, kind: "app" },
    });
  });

  it("opens a file's app address as its path", async () => {
    const result = await run(
      {},
      "show",
      "instrument://file/Users/me/Instrument/report.md",
    );

    expect(result.exitCode).toBe(0);
    expect(asked[0]?.action).toEqual({
      kind: "open",
      show: true,
      target: { kind: "path", path: "/Users/me/Instrument/report.md" },
    });
  });

  it("refuses an app address that names nothing", async () => {
    const result = await run({}, "show", "instrument://new-chat");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument window: "instrument://new-chat" names nothing the window shows.
      "
    `);
    expect(asked).toEqual([]);
  });

  it("names the chat that asked", async () => {
    await run({}, "show", "https://example.com/");

    expect(asked[0]?.chatId).toBe(chatId);
  });

  it("still opens the page when no window answers", async () => {
    stopAnswering();
    const result = await run({ timeoutMs: 20 }, "show", "https://example.com/");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Opened https://example.com/.\n");
  });
});

describe("window close, show and read on a tab", () => {
  it("closes a tab by its id", async () => {
    const result = await run({}, "close", "tab_known");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "Closed tab tab_known. Its side closed. Showing: zendesk.com/pricing.
      "
    `);
  });

  it("says what the side a tab closed from shows now", async () => {
    await run({}, "show", "https://example.com/");

    const result = await run({}, "close", pageTab);

    expect(result.stdout.replaceAll(pageTab, "<page>")).toMatchInlineSnapshot(`
      "Closed tab <page>. That side now shows example.com.
      "
    `);
  });

  it("says what a side of another group shows once its tab closed", async () => {
    const result = await run({}, "close", "tab_hn");

    expect(result.stdout).toMatchInlineSnapshot(`
      "Closed tab tab_hn. That side of the tab group "Meeting notes" instrument://group/group:notes now shows example.com; the window shows another tab group, so it is out of sight.
      "
    `);
  });

  it("says which task was working in a tab it closed", async () => {
    holders.set("tab_known", {
      id: "read-the-page",
      session: StoreId.newSessionId(),
      title: "Read the page",
    });

    const result = await run({}, "close", "tab_known");

    expect(result.stdout).toContain(
      'Task read-the-page ("Read the page") was working in it',
    );
  });

  it("passes on the window's refusal of a tab it does not have", async () => {
    const result = await run({}, "close", "tab_gone");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "instrument window: no tab tab_gone is open in this chat.\n",
    );
  });

  it("points a tab at a page", async () => {
    const result = await run(
      {},
      "show",
      "https://example.com/",
      "--in",
      pageTab,
    );

    expect(result.stdout.replaceAll(pageTab, "<page>")).toMatchInlineSnapshot(`
      "Tab <page> now shows https://example.com/: showing on the right side, beside you.
      "
    `);
    expect(asked[0]?.action).toEqual({
      kind: "replace",
      tabId: pageTab,
      target: { kind: "page", url: "https://example.com/" },
    });
  });

  it("shows a tab and says where it is", async () => {
    const result = await run({}, "show", pageTab);

    expect(result.stdout.replaceAll(pageTab, "<page>")).toBe(
      "Tab <page>: showing on the right side, beside you.\n",
    );
    expect(asked[0]?.action).toEqual({ kind: "show", tabId: pageTab });
  });

  it("prints the text of the page in a tab", async () => {
    const result = await run({}, "read", "tab_known");

    expect(asked[0]?.action).toEqual({ kind: "read", tabId: "tab_known" });
    expect(result.stdout).toBe("Jar\nA rigid container.\n");
  });

  it("reads a local page under the chat's own folder", async () => {
    pageUrls = [pathToFileURL(path.join(chatFolder, "notes.html")).href];
    const result = await run({}, "read", pageTab);

    expect(result.stdout).toBe("Jar\nA rigid container.\n");
  });

  it("refuses to read a tab on a file outside the chat's folders", async () => {
    pageUrls = ["file:///Users/someone/secrets.txt"];
    const result = await run({}, "read", pageTab);

    expect(asked).toEqual([]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      `instrument window: tab ${pageTab} shows a file outside your folders, so it can't be read.\n`,
    );
  });

  // A page can send its own tab to another file while the window reads it.
  it("withholds the text when the tab moved outside the chat's folders during the read", async () => {
    pageUrls = ["https://example.com/", "file:///Users/"];
    const result = await run({}, "read", pageTab);

    expect(asked).toHaveLength(1);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("passes on the window's refusal to read a tab it does not have", async () => {
    const result = await run({}, "read", "tab_gone");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "instrument window: no tab tab_gone is open in this chat.\n",
    );
  });

  it("says nothing changed when no window answers", async () => {
    stopAnswering();
    const result = await run({ timeoutMs: 20 }, "show", "tab_known");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("the window did not answer");
  });

  // Bare, it is asked for its usage, as every command made of subcommands is.
  it("prints the usage when run bare", async () => {
    const result = await run({});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: instrument window <subcommand>");
    expect(result.stdout).toContain("instrument window list");
  });

  it.each([
    { args: ["close"] },
    { args: ["show"] },
    { args: ["show", "--in", "tab_known"] },
    { args: ["show", "tab_gone", "--in", "tab_known"] },
  ])("names the form it takes for $args", async ({ args }) => {
    const result = await run({}, ...args);

    expect(result.exitCode).toBe(1);
    expect(asked).toEqual([]);
    expect(result.stderr).toMatchSnapshot();
  });
});

describe("window list", () => {
  it("names what is in the window by the ids the other subcommands and agent-browser tab take", async () => {
    holders.set(pageTab, {
      id: "t1",
      session: StoreId.newSessionId(),
      title: "Compare plans",
    });
    const result = await run({}, "list");

    expect(result.exitCode).toBe(0);
    expect(result.stdout.replaceAll(pageTab, "<page>")).toMatchInlineSnapshot(`
      "Tab group "Prices" instrument://group/group_a, split, on screen:
        left:
          tab_known  left     [chat] Prices (you)  instrument://chat/this
        right (keyboard):
          <page>  right    Suite plans · https://www.zendesk.com/pricing/  instrument://tab/<page>  task t1 is working in it
      Showing: you on the left; zendesk.com/pricing on the right, beside you.
      2 other tab groups in this window: "report.md" (pinned), "Meeting notes". 1 other window has 1 tab group. \`instrument window list --all\` lists their tabs.
      "
    `);
  });

  it("tells a task the tab it is working in is its own", async () => {
    const session = StoreId.newSessionId();
    holders.set(pageTab, { id: "t2", session, title: "Checkout details" });
    const result = await run({ role: "task", sessionId: session }, "list");

    expect(result.exitCode).toBe(0);
    expect(result.stdout.replaceAll(pageTab, "<page>")).toMatchInlineSnapshot(`
      "Tab group "Prices" instrument://group/group_a, split, on screen:
        left:
          tab_known  left     [chat] Prices (you)  instrument://chat/this
        right (keyboard):
          <page>  right    Suite plans · https://www.zendesk.com/pricing/  instrument://tab/<page>  you are working in it
      Showing: you on the left; zendesk.com/pricing on the right, beside you.
      2 other tab groups in this window: "report.md" (pinned), "Meeting notes". 1 other window has 1 tab group. \`instrument window list --all\` lists their tabs.
      "
    `);
  });
});

describe("window list --json", () => {
  it("has the pin, project, unsent words, last showing and chat state a script filters by", async () => {
    const result = await run({}, "list", "--all", "--json");
    const listed = JSON.parse(result.stdout) as {
      chats: unknown;
      projects: unknown;
      windows: { groups: Record<string, unknown>[] }[];
    };
    expect(listed.windows[0]?.groups[1]).toMatchObject({
      drafts: { tab_new: "Ask about rent" },
      pinned: true,
      project: "project_launch",
      shownAt: Date.UTC(2026, 10, 24, 9, 12),
    });
    expect(listed.windows[0]?.groups[2]?.marks).toEqual({
      tab_ex: { failed: true },
      tab_hn: { using: { camera: true, microphone: true, paused: false } },
    });
    expect(listed.projects).toEqual({ project_launch: "Launch" });
    expect(listed.chats).toEqual({
      tab_notes: {
        archived: false,
        last_activity: "2026-11-23",
        latest: "Which **one**\nfirst?",
        starred: false,
        status: "waiting",
        unread: true,
        working: true,
      },
    });
  });
});

describe("window list, of other groups", () => {
  it("lists every window's groups with --all", async () => {
    const result = await run({}, "list", "--all");

    expect(result.exitCode).toBe(0);
    expect(result.stdout.replaceAll(pageTab, "<page>")).toMatchInlineSnapshot(`
      "Window 1, in front, yours: 3 tab groups
        Tab group "Prices" instrument://group/group_a, split, on screen:
          left:
            tab_known  left     [chat] Prices (you)  instrument://chat/this
          right (keyboard):
            <page>  right    Suite plans · https://www.zendesk.com/pricing/  instrument://tab/<page>
        Tab group "report.md" instrument://group/group:docs, pinned, in the project "Launch", not on screen, last brought up 2026-11-24T09:12Z:
          tab_docs  showing  /Users/me/Instrument/report.md  instrument://tab/tab_docs
          tab_settings  hidden   [app] Settings · instrument://screen/settings  instrument://tab/tab_settings
          tab_new  hidden   New Tab  instrument://tab/tab_new  (unsent: "Ask about rent", kept in Drafts if closed)
          tab_task  hidden   [app] Read the menu · instrument://task/ses_01ARZ3NDEKTSV4RRFFQ69G5FAV?chat=notes  instrument://tab/tab_task  (working: "Reading the menu")
        Tab group "Meeting notes" instrument://group/group:notes, split, not on screen:
          left (keyboard):
            tab_notes  left     [chat] Meeting notes  instrument://chat/notes  (waiting on the user, still working, unread, latest: "Which **one** first?", last active 2026-11-23)
          right:
            tab_hn  right    Hacker News · https://news.ycombinator.com/  instrument://tab/tab_hn  (using the user's camera and microphone)
            tab_ex  hidden   Example · https://example.com/  instrument://tab/tab_ex  (opened by an agent, can't connect)
      Window 2: 1 tab group
        Tab group "report.md" instrument://group/group:far, on screen:
          tab_far  showing  report.md · https://example.org/  instrument://tab/tab_far
      "
    `);
  });

  it("lists a group by its name, in any case, where one group has it", async () => {
    const result = await run({}, "list", "meeting NOTES");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "Tab group "Meeting notes" instrument://group/group:notes, split, not on screen:
        left (keyboard):
          tab_notes  left     [chat] Meeting notes  instrument://chat/notes  (waiting on the user, still working, unread, latest: "Which **one** first?", last active 2026-11-23)
        right:
          tab_hn  right    Hacker News · https://news.ycombinator.com/  instrument://tab/tab_hn  (using the user's camera and microphone)
          tab_ex  hidden   Example · https://example.com/  instrument://tab/tab_ex  (opened by an agent, can't connect)
      The window shows another tab group now, so none of this is on screen. This group shows: [chat] Meeting notes on the left; news.ycombinator.com on the right.
      2 other tab groups in this window: "Prices", "report.md" (pinned). 1 other window has 1 tab group. \`instrument window list --all\` lists their tabs.
      "
    `);
  });

  it("lists a group by its address", async () => {
    const result = await run({}, "list", "instrument://group/group:docs");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Tab group "report.md"');
  });

  it("names every group a name could mean", async () => {
    const result = await run({}, "list", "report.md");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument window: 2 tab groups are named "report.md": instrument://group/group:docs, instrument://group/group:far. Name one by its id.
      "
    `);
  });
});

describe("window show and close, of a group", () => {
  it("switches the window to a group by its id", async () => {
    const result = await run({}, "show", "group:docs");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "Tab group "report.md" instrument://group/group:docs: on screen, its window in front.
      "
    `);
    expect(asked[0]?.action).toEqual({
      group: "group:docs",
      kind: "showGroup",
    });
  });

  it("takes a tab's address as the tab, and says which group it is in", async () => {
    const result = await run({}, "show", "instrument://tab/tab_docs");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "Tab tab_docs: in the tab group "report.md" instrument://group/group:docs, showing in the group's one side; the window shows another tab group now, so it is not on screen.
      "
    `);
    expect(asked[0]?.action).toEqual({ kind: "show", tabId: "tab_docs" });
  });

  it("opens into another group by its name, without switching to it", async () => {
    const result = await run(
      {},
      "show",
      "https://example.com/",
      "--group",
      "Meeting notes",
    );

    expect(result.exitCode).toBe(0);
    expect(asked[1]?.action).toEqual({
      group: "group:notes",
      kind: "open",
      show: true,
      target: { kind: "page", url: "https://example.com/" },
    });
  });

  it("closes a group whole, naming it and how to bring it back", async () => {
    const result = await run({}, "close", "group:notes");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "Closed the tab group "Meeting notes" instrument://group/group:notes, its 3 tabs. The user can bring it back with Undo or from Recently Closed.
      "
    `);
    expect(asked.map(({ action }) => action.kind)).toEqual([
      "list",
      "closeGroup",
    ]);
  });

  it("closes a group of only an agent's tabs without offering it back", async () => {
    const result = await run({}, "close", "group:docs");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "Closed the tab group "report.md" instrument://group/group:docs, its 4 tabs.
      "
    `);
  });

  it("passes on the window's refusal of a group it does not have", async () => {
    const result = await run({}, "close", "group:gone");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "instrument window: no tab group group:gone is open.\n",
    );
  });
});

describe("window group, move, history and restore", () => {
  it("makes a group of tabs and names it by its link", async () => {
    const result = await run(
      {},
      "group",
      "tab_docs",
      "instrument://tab/tab_hn",
    );

    expect(result.exitCode).toBe(0);
    expect(asked[0]?.action).toEqual({
      kind: "groupTabs",
      tabIds: ["tab_docs", "tab_hn"],
    });
    expect(result.stdout).toMatchInlineSnapshot(`
      "Made the tab group "report.md" instrument://group/group:docs of tab_docs, tab_hn; the window stays on the group it shows.
      "
    `);
  });

  it("moves tabs into a group named by its name", async () => {
    const result = await run({}, "move", "tab_ex", "--group", "meeting notes");

    expect(result.exitCode).toBe(0);
    expect(asked[1]?.action).toEqual({
      group: "group:notes",
      kind: "moveTabs",
      tabIds: ["tab_ex"],
    });
    expect(result.stdout).toMatchInlineSnapshot(`
      "Moved tab_ex into the tab group "Meeting notes" instrument://group/group:notes; the window shows another group, so they are out of sight.
      "
    `);
  });

  it("puts tabs on a side and beside a tab, and joins sides", async () => {
    const results = [
      await run({}, "move", "tab_hn", "--side", "right"),
      await run(
        {},
        "move",
        "tab_ex",
        "instrument://tab/tab_hn",
        "--after",
        "tab_notes",
      ),
      await run(
        {},
        "move",
        "tab_hn",
        "--group",
        "Meeting notes",
        "--before",
        "tab_ex",
      ),
      await run({}, "join", "Meeting notes"),
      await run({}, "join"),
      await run({}, "move", "tab_hn"),
      await run({}, "move", "tab_hn", "--side", "top"),
      await run({}, "move", "tab_hn", "--side", "left", "--after", "tab_ex"),
    ];

    expect(
      asked.map(({ action }) => action).filter(({ kind }) => kind !== "list"),
    ).toMatchInlineSnapshot(`
      [
        {
          "kind": "moveTabs",
          "side": "right",
          "tabIds": [
            "tab_hn",
          ],
        },
        {
          "kind": "moveTabs",
          "place": {
            "anchor": "tab_notes",
            "where": "after",
          },
          "tabIds": [
            "tab_ex",
            "tab_hn",
          ],
        },
        {
          "group": "group:notes",
          "kind": "moveTabs",
          "place": {
            "anchor": "tab_ex",
            "where": "before",
          },
          "tabIds": [
            "tab_hn",
          ],
        },
        {
          "group": "group:notes",
          "kind": "joinSides",
        },
        {
          "group": "group_a",
          "kind": "joinSides",
        },
      ]
    `);
    expect(
      results.map(({ exitCode, stderr, stdout }) => ({
        exitCode,
        said: stderr || stdout,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "exitCode": 0,
          "said": "Moved tab_hn: in the tab group "Meeting notes" instrument://group/group:notes, showing on the right side; the window shows another tab group now, so it is not on screen.
      ",
        },
        {
          "exitCode": 0,
          "said": "Moved tab_ex: in the tab group "Meeting notes" instrument://group/group:notes, hidden on the right side, behind news.ycombinator.com; the window shows another tab group now, so it is not on screen.
      Moved tab_hn: in the tab group "Meeting notes" instrument://group/group:notes, showing on the right side; the window shows another tab group now, so it is not on screen.
      ",
        },
        {
          "exitCode": 0,
          "said": "Moved tab_hn: in the tab group "Meeting notes" instrument://group/group:notes, showing on the right side; the window shows another tab group now, so it is not on screen.
      ",
        },
        {
          "exitCode": 0,
          "said": "Joined the sides of the tab group "Meeting notes" instrument://group/group:notes. The window shows another tab group now, so none of this is on screen. This group shows: [chat] Meeting notes on the left; news.ycombinator.com on the right.
      ",
        },
        {
          "exitCode": 0,
          "said": "Joined the sides of the tab group "Prices" instrument://group/group_a. Showing: you on the left; zendesk.com/pricing on the right, beside you.
      ",
        },
        {
          "exitCode": 1,
          "said": "instrument window: move needs the group to move them into (instrument window move <tab id>... --group <group>), or --side, --before or --after.
      ",
        },
        {
          "exitCode": 1,
          "said": "instrument window: side: Invalid option: expected one of "left"|"right"
      ",
        },
        {
          "exitCode": 1,
          "said": "instrument window: move takes one of --side, --before and --after; a tab is put on the side of the tab it goes beside.
      ",
        },
      ]
    `);
  });

  it("puts a group, or tabs, in a new window", async () => {
    const results = [
      await run({}, "new", "Meeting notes"),
      await run({}, "new", "tab_hn", "instrument://tab/tab_ex"),
      await run({}, "new", "tab_hn", "Meeting notes"),
    ];
    expect(
      asked.map(({ action }) => action).filter(({ kind }) => kind !== "list"),
    ).toEqual([
      { group: "group:notes", kind: "newWindow", tabIds: [] },
      { kind: "newWindow", tabIds: ["tab_hn", "tab_ex"] },
    ]);
    expect(results.map(({ stderr, stdout }) => stderr || stdout))
      .toMatchInlineSnapshot(`
      [
        "Opened a new window on the tab group instrument://group/group:notes.
      ",
        "Opened a new window on the tab group instrument://group/group:new.
      ",
        "instrument window: new takes one tab group, or tabs by their ids.
      ",
      ]
    `);
  });

  it("opens no window in a turn the user did not start, nor for a task", async () => {
    personsTurn = false;
    const woken = await run({}, "new", "tab_hn");
    personsTurn = true;
    const task = await run({ role: "task" }, "new", "tab_hn");
    expect(asked).toEqual([]);
    expect([woken, task].map(({ exitCode, stderr }) => ({ exitCode, stderr })))
      .toMatchInlineSnapshot(`
      [
        {
          "exitCode": 1,
          "stderr": "instrument window: a new window opens only in a turn the user started, when their message asks for one, and something else has woken you since theirs. Leave the window as it is.
      ",
        },
        {
          "exitCode": 1,
          "stderr": "instrument window: only the chat changes the window. To open a page to work in, use \`agent-browser tab new <url>\`; say in your report what the chat should show.
      ",
        },
      ]
    `);
  });

  it("pins, unpins and places groups by name", async () => {
    const results = [
      await run({}, "pin", "Meeting notes", "group:docs"),
      await run({}, "unpin", "group:docs"),
      await run({}, "place", "Meeting notes", "--after", "group:docs"),
      await run({}, "place", "Meeting notes"),
    ];
    expect(results.map(({ stderr, stdout }) => stdout + stderr))
      .toMatchInlineSnapshot(`
      [
        "Pinned the tab group "Meeting notes" instrument://group/group:notes.
      The tab group "report.md" instrument://group/group:docs is already pinned.
      ",
        "Unpinned the tab group "report.md" instrument://group/group:docs.
      ",
        "Placed the tab group "Meeting notes" instrument://group/group:notes just below "report.md" instrument://group/group:docs.
      ",
        "instrument window: place takes one of --before and --after: instrument window place <group> --before <group>.
      ",
      ]
    `);
  });

  it("lists History newest first, the closed entries by the id restore takes", async () => {
    const result = await run({}, "history", "--limit", "5");

    expect(result.exitCode).toBe(0);
    expect(asked[0]?.action).toEqual({
      closedOnly: false,
      kind: "history",
      limit: 5,
    });
    expect(result.stdout).toMatchInlineSnapshot(`
      "tab_closed1  2026-11-15T09:30:00.000Z  closed tab group: Trip planning (3 tabs)
      2026-11-15T09:20:00.000Z  visited: Example Domain (example.com)  https://example.com/
      "
    `);
  });

  it("restores a closed entry by its id", async () => {
    const result = await run({}, "restore", "tab_closed1");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "Restored tab_closed1, as History's restore does. Tab tab_back: showing on the right side, beside you.
      "
    `);
  });

  it("names the tabs a restore brought back and whether they are on screen", async () => {
    const result = await run({}, "restore", "tab_closed2");

    expect(result.stdout).toMatchInlineSnapshot(`
      "Restored tab_closed2, as History's restore does. As tabs tab_b1, tab_b2; it is on screen.
      "
    `);
  });

  it("says a group tabs moved into is on screen", async () => {
    const result = await run({}, "move", "tab_ex", "--group", "group_a");

    expect(result.stdout).toMatchInlineSnapshot(`
      "Moved tab_ex into the tab group "Prices" instrument://group/group_a; it is on screen.
      "
    `);
  });

  it("shows the page it waits on and says where it stands", async () => {
    const result = await run(
      {},
      "wait",
      pageTab,
      "--title",
      "Log in",
      "--reason",
      "Only you can sign in.",
    );

    expect(result.exitCode).toBe(0);
    expect(asked.map(({ action }) => action.kind)).toEqual([
      "list",
      "show",
      "list",
    ]);
    expect(raised).toHaveLength(1);
    expect(result.stdout.replaceAll(pageTab, "<page>")).toMatchInlineSnapshot(`
      "Showed the user tab <page> ("Suite plans") with a card above the reply box titled "Log in", your reason, Done and Skip. Tab <page>: showing on the right side, beside you. Your turn ends here; their answer wakes you.
      "
    `);
  });

  it("raises no card when the window would not show the page", async () => {
    refusedShows.add(pageTab);

    const result = await run(
      {},
      "wait",
      pageTab,
      "--title",
      "Log in",
      "--reason",
      "Only you can sign in.",
    );

    expect(result.exitCode).toBe(1);
    expect(raised).toEqual([]);
    expect(result.stderr.replaceAll(pageTab, "<page>")).toMatchInlineSnapshot(`
      "instrument window: tab <page> could not be shown, so no card was raised: tab <page> is in a window that is closing.
      "
    `);
  });

  it("passes on the window's refusal of an id History does not have", async () => {
    const result = await run({}, "restore", "tab_nope");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("nothing in History is tab_nope");
  });
});

describe("in a task", () => {
  it.each([["list"], ["read", "tab_known"]])(
    "reads the window: %j",
    async (...args) => {
      const result = await run({ role: "task" }, ...args);

      expect(result.exitCode).toBe(0);
      expect(asked).toHaveLength(1);
    },
  );

  it.each([
    ["show", "https://example.com/"],
    ["show", "tab_known"],
    ["show", "https://example.com/", "--in", "tab_known"],
    ["close", "tab_known"],
    ["group", "tab_known"],
    ["move", "tab_known", "--group", "group:docs"],
    ["restore", "tab_closed1"],
  ])("changes nothing, and says what to do instead: %j", async (...args) => {
    const result = await run({ role: "task" }, ...args);

    expect(result.exitCode).toBe(1);
    expect(asked).toEqual([]);
    expect(raised).toEqual([]);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument window: only the chat changes the window. To open a page to work in, use \`agent-browser tab new <url>\`; say in your report what the chat should show.
      "
    `);
  });
});
