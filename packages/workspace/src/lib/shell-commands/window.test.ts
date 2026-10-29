import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publisher } from "../../rpc/publisher";
import { ChatIdSchema, type ChatId } from "../../schemas/chat-id";
import { WorkDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type WindowTabAction } from "../../schemas/window-tab";
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
const pageTab = StoreId.newTabId();
let pageUrls: string[];
// The address the window lists the page tab at.
let listedUrl: string;

// Which task is at work in which tab, as the chat's tasks' records would say.
const holders = new Map<
  string,
  { id: ReturnType<typeof ChatIdSchema.parse>; title: string }
>();
// How long a call waits on the window, short where a test has none answer.
let windowTimeoutMs = 2000;
vi.mock(import("../chat/window-tab"), async (importOriginal) => ({
  ...(await importOriginal()),
  tabHolders: () => Promise.resolve(holders),
  get WINDOW_TAB_TIMEOUT_MS() {
    return windowTimeoutMs;
  },
}));

// The cards a request raised, as the chat's state would keep them.
const raised: unknown[][] = [];
vi.mock(import("../chat/asks"), async (importOriginal) => ({
  ...(await importOriginal()),
  recordAsk: (...args: unknown[]) => {
    raised.push(args);
    return Promise.resolve("ask-1");
  },
}));

// A tab of the user's own, outside the chat, which a note named.
const theirTab = StoreId.newTabId();

let asked: { action: WindowTabAction; chatId?: ChatId }[];
let stopAnswering: () => void;

/**
 * A window with two tabs open, `tab_known` and a page in front: answers each
 * ask the way the window does, with a new tab for an open and an error for
 * an id it has not got.
 */
function answeringWindow() {
  const known = new Set<string>(["tab_known", pageTab]);
  return publisher.subscribe("window.tab", (ask) => {
    asked.push({
      action: ask.action,
      ...(ask.chatId ? { chatId: ask.chatId } : {}),
    });
    const { action } = ask;
    const answer =
      action.kind === "open"
        ? { tabId: `made-${asked.length}` }
        : action.kind === "list"
          ? {
              tabs: [...known].map((id) =>
                id === pageTab
                  ? {
                      front: true,
                      id,
                      kind: "page" as const,
                      title: "Suite plans",
                      url: listedUrl,
                    }
                  : { id, kind: "screen" as const },
              ),
            }
          : action.kind === "theirs"
            ? action.tabId === theirTab
              ? {
                  tabs: [
                    {
                      id: theirTab,
                      kind: "page" as const,
                      title: "Shopping Cart",
                      url: "https://www.amazon.com/gp/cart/view.html",
                    },
                  ],
                }
              : {
                  error: `no tab ${action.tabId} of the user's is open outside a chat.`,
                }
            : known.has(action.tabId)
              ? {
                  tabId: action.tabId,
                  ...(action.kind === "read"
                    ? { text: "Jar\nA rigid container." }
                    : {}),
                }
              : { error: `no tab ${action.tabId} is open in this chat.` };
    publisher.publish("window.tabDone", {
      id: ask.id,
      requestId: ask.requestId,
      ...answer,
    });
  });
}

function run(
  options: {
    files?: Record<string, string>;
    role?: "chat" | "task";
    timeoutMs?: number;
  },
  ...args: string[]
) {
  const fsTree = new InMemoryFs();
  fsTree.writeFileSync("/Users/me/Instrument/report.md", "# report");
  for (const [at, content] of Object.entries(options.files ?? {})) {
    fsTree.writeFileSync(at, content);
  }
  windowTimeoutMs = options.timeoutMs ?? 2000;
  return createWindowCommand({
    chatId,
    layout,
    role: options.role ?? "chat",
    sessionId: StoreId.newSessionId(),
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
  raised.length = 0;
  holders.clear();
  pageUrls = [];
  listedUrl = "https://www.zendesk.com/pricing/";
  const config = getWorkspaceConfig();
  setWorkspaceConfig({
    ...config,
    browser: {
      ...config.browser,
      getTargetUrl: () =>
        pageUrls.length > 1 ? pageUrls.shift() : pageUrls[0],
    },
  });
  stopAnswering = answeringWindow();
});

afterEach(() => {
  stopAnswering();
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
      "Opened https://example.com/ in front (tab made-1)\nOpened https://example.org/ in front (tab made-2)\n",
    );
    expect(asked.map(({ action }) => action)).toEqual([
      {
        kind: "open",
        show: true,
        target: { kind: "page", url: "https://example.com/" },
      },
      {
        kind: "open",
        show: true,
        target: { kind: "page", url: "https://example.org/" },
      },
    ]);
  });

  // A terminal's `open` stands you in a folder, and so does this one. The
  // slash is how the window is told which of the two it was handed.
  it("opens a folder, named with the slash that says it is one", async () => {
    const result = await run({}, "show", "/Users/me/Instrument");

    expect(result.stdout).toBe(
      "Opened /Users/me/Instrument/ in front (tab made-1)\n",
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
      "Opened /Users/me/Instrument/report.md in front (tab made-2)\n",
    );
  });

  describe("a file a page tab already shows", () => {
    const checked = path.join(chatFolder, "forecast/forecast.html");
    const delivered = "/Users/me/Instrument/Forecast.html";
    const page = "<h1>Forecast</h1>";

    beforeEach(() => {
      listedUrl = pathToFileURL(checked).href;
    });

    it("shows a copy with the same bytes in that tab", async () => {
      const result = await run(
        { files: { [checked]: page, [delivered]: page } },
        "show",
        delivered,
      );

      expect(result.stdout).toBe(
        `Opened ${delivered} in front (tab ${pageTab}), in place of tab ${pageTab}, which showed the same page.\n`,
      );
      expect(asked.map(({ action }) => action).slice(1)).toEqual([
        {
          kind: "replace",
          tabId: pageTab,
          target: { kind: "path", path: delivered },
        },
        { kind: "show", tabId: pageTab },
      ]);
    });

    it("opens a tab of its own for a file that differs", async () => {
      const result = await run(
        { files: { [checked]: page, [delivered]: "<h1>Forecast!</h1>" } },
        "show",
        delivered,
      );

      expect(result.stdout).toBe(`Opened ${delivered} in front (tab made-2)\n`);
    });

    it("leaves a tab a task is working in to the task", async () => {
      holders.set(pageTab, {
        id: ChatIdSchema.parse("t1"),
        title: "Forecast",
      });
      const result = await run(
        { files: { [checked]: page, [delivered]: page } },
        "show",
        delivered,
      );

      expect(result.stdout).toBe(`Opened ${delivered} in front (tab made-2)\n`);
    });
  });

  it("names the chat that asked", async () => {
    await run({}, "show", "https://example.com/");

    expect(asked[0]?.chatId).toBe(chatId);
  });

  it("still opens the page when no window answers", async () => {
    stopAnswering();
    const result = await run({ timeoutMs: 20 }, "show", "https://example.com/");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Opened https://example.com/ in front\n");
  });
});

describe("window close, show and read on a tab", () => {
  it("closes a tab by its id", async () => {
    const result = await run({}, "close", "tab_known");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Closed tab tab_known.\n");
  });

  it("says which task was working in a tab it closed", async () => {
    holders.set("tab_known", {
      id: ChatIdSchema.parse("read-the-page"),
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
      "tab_known",
    );

    expect(result.stdout).toBe(
      "Tab tab_known now shows https://example.com/.\n",
    );
    expect(asked[0]?.action).toEqual({
      kind: "replace",
      tabId: "tab_known",
      target: { kind: "page", url: "https://example.com/" },
    });
  });

  it("brings a tab forward", async () => {
    const result = await run({}, "show", "tab_known");

    expect(result.stdout).toBe("Tab tab_known is in front.\n");
    expect(asked[0]?.action).toEqual({ kind: "show", tabId: "tab_known" });
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
    { args: ["request"] },
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
  it("names what is in the window by the ids the other subcommands and --tab take", async () => {
    holders.set(pageTab, {
      id: ChatIdSchema.parse("t1"),
      title: "Compare plans",
    });
    const result = await run({}, "list");

    expect(result.exitCode).toBe(0);
    expect(result.stdout.replaceAll(pageTab, "<page>")).toMatchInlineSnapshot(`
      "tab_known  behind    a screen of the app, not a page
      <page>  in front  Suite plans · https://www.zendesk.com/pricing/  task t1 is working in it
      "
    `);
  });
});

describe("window request", () => {
  it("raises a card for a tab of the user's a note named, and says the turn ends on it", async () => {
    const result = await run(
      {},
      "request",
      theirTab,
      "--reason",
      "So I can pick up your cart where you left it.",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.replaceAll(theirTab, "<theirs>"))
      .toMatchInlineSnapshot(`
      "Asked the user to move tab <theirs> ("Shopping Cart") into this chat. The card shows your reason with Move tab here and Skip. Your turn ends here; their answer wakes you.
      "
    `);
    expect(raised).toEqual([
      [
        expect.objectContaining({
          reason: "So I can pick up your cart where you left it.",
        }),
        "tab",
        theirTab,
        {
          page: {
            title: "Shopping Cart",
            url: "https://www.amazon.com/gp/cart/view.html",
          },
        },
      ],
    ]);
  });

  it.each([
    ["a tab already the chat's", () => [pageTab, "--reason", "To read it."]],
    [
      "a tab no note named",
      () => ["tab_01M5Q0AAAAAAAAAAAAAAAAAAAA", "--reason", "To read it."],
    ],
    ["no reason", () => [theirTab]],
  ])("refuses %s, raising nothing", async (_, args) => {
    const result = await run({}, "request", ...args());

    expect(result.exitCode).toBe(1);
    expect(
      result.stderr
        .replaceAll(pageTab, "<page>")
        .replaceAll(theirTab, "<theirs>"),
    ).toMatchSnapshot();
    expect(raised).toEqual([]);
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
    ["request", "tab_known", "--reason", "To read it."],
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
