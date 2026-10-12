import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publisher } from "../../rpc/publisher";
import { ChatIdSchema, type ChatId } from "../../schemas/chat-id";
import { ChatDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type WindowTabAction } from "../../schemas/window-tab";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { buildWorkspaceFsLayout } from "../workspace-fs-layout";
import { createTabCommand } from "./tab";

const chatId = ChatIdSchema.parse("tab-command-chat");
const layout = buildWorkspaceFsLayout({
  taskHostRoot: ChatDirSchema.parse("/work/chats/tab-command-chat"),
});

// A page tab, by the session id the window's page tabs carry, and the
// addresses the browser reports it showing, one per ask, the last repeating.
const pageTab = StoreId.newSessionId();
let pageUrls: string[];

// Which task is at work in which tab, as the chat's tasks' records would say.
const holders = new Map<
  string,
  { id: ReturnType<typeof ChatIdSchema.parse>; title: string }
>();
vi.mock(import("../chat/window-tab"), async (importOriginal) => ({
  ...(await importOriginal()),
  tabHolders: () => Promise.resolve(holders),
}));

let asked: { action: WindowTabAction; chatId?: ChatId }[];
let stopAnswering: () => void;

/**
 * A window with one tab open, `tab-known`: answers each ask the way the
 * window does, with a new tab for an open and an error for an id it has not
 * got.
 */
function answeringWindow() {
  const known = new Set<string>(["tab-known", pageTab]);
  return publisher.subscribe("window.tab", (ask) => {
    asked.push({
      action: ask.action,
      ...(ask.chatId ? { chatId: ask.chatId } : {}),
    });
    const { action } = ask;
    const answer =
      action.kind === "open"
        ? { tabId: `made-${asked.length}` }
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

function run(options: { timeoutMs?: number }, ...args: string[]) {
  const fsTree = new InMemoryFs();
  fsTree.writeFileSync("/mnt/Instrument/report.md", "# report");
  return createTabCommand({ chatId, layout, ...options }).execute(
    args,
    createCommandContext({
      cwd: "/task",
      env: new Map<string, string>(),
      fs: fsTree,
      stdin: EMPTY_BYTES,
    }),
  );
}

beforeEach(() => {
  asked = [];
  holders.clear();
  pageUrls = [];
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

describe("tab open", () => {
  it("prints the tab the window made for each page, so a task can be handed it", async () => {
    const result = await run(
      {},
      "open",
      "https://example.com/",
      "https://example.org/",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "Opened https://example.com/ (tab made-1)\nOpened https://example.org/ (tab made-2)\n",
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
    const result = await run({}, "open", "/mnt/Instrument");

    expect(result.stdout).toBe("Opened /mnt/Instrument/ (tab made-1)\n");
    expect(asked[0]?.action).toEqual({
      kind: "open",
      show: true,
      target: { kind: "path", mount: "/mnt/Instrument/" },
    });
  });

  it("refuses a path the window cannot show, and opens the rest", async () => {
    const result = await run(
      {},
      "open",
      "/etc/hosts",
      "/mnt/Instrument/report.md",
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('"/etc/hosts" is not a page');
    expect(result.stdout).toBe(
      "Opened /mnt/Instrument/report.md (tab made-1)\n",
    );
  });

  it("names the chat that asked", async () => {
    await run({}, "open", "https://example.com/");

    expect(asked[0]?.chatId).toBe(chatId);
  });

  it("still opens the page when no window answers", async () => {
    stopAnswering();
    const result = await run({ timeoutMs: 20 }, "open", "https://example.com/");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Opened https://example.com/\n");
  });
});

describe("tab close, replace and show", () => {
  it("closes a tab by its id", async () => {
    const result = await run({}, "close", "tab-known");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Closed tab tab-known.\n");
  });

  it("says which task was working in a tab it closed", async () => {
    holders.set("tab-known", {
      id: ChatIdSchema.parse("read-the-page"),
      title: "Read the page",
    });

    const result = await run({}, "close", "tab-known");

    expect(result.stdout).toContain(
      'Task read-the-page ("Read the page") was working in it',
    );
  });

  it("passes on the window's refusal of a tab it does not have", async () => {
    const result = await run({}, "close", "tab-gone");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("tab: no tab tab-gone is open in this chat.\n");
  });

  it("points a tab at a page", async () => {
    const result = await run(
      {},
      "replace",
      "tab-known",
      "https://example.com/",
    );

    expect(result.stdout).toBe(
      "Tab tab-known now shows https://example.com/.\n",
    );
    expect(asked[0]?.action).toEqual({
      kind: "replace",
      tabId: "tab-known",
      target: { kind: "page", url: "https://example.com/" },
    });
  });

  it("brings a tab forward", async () => {
    const result = await run({}, "show", "tab-known");

    expect(result.stdout).toBe("Tab tab-known is on the user's screen.\n");
  });

  it("prints the text of the page in a tab", async () => {
    const result = await run({}, "read", "tab-known");

    expect(asked[0]?.action).toEqual({ kind: "read", tabId: "tab-known" });
    expect(result.stdout).toBe("Jar\nA rigid container.\n");
  });

  it("reads a local page under the chat's own folder", async () => {
    pageUrls = ["file:///work/chats/tab-command-chat/notes.html"];
    const result = await run({}, "read", pageTab);

    expect(result.stdout).toBe("Jar\nA rigid container.\n");
  });

  it("refuses to read a tab on a file outside the chat's folders", async () => {
    pageUrls = ["file:///Users/someone/secrets.txt"];
    const result = await run({}, "read", pageTab);

    expect(asked).toEqual([]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      `tab: tab ${pageTab} shows a file outside your folders, so it can't be read.\n`,
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
    const result = await run({}, "read", "tab-gone");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("tab: no tab tab-gone is open in this chat.\n");
  });

  it("says nothing changed when no window answers", async () => {
    stopAnswering();
    const result = await run({ timeoutMs: 20 }, "show", "tab-known");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("the window did not answer");
  });

  // Bare, it is asked for its usage, as every command made of subcommands is.
  it("prints the usage when run bare", async () => {
    const result = await run({});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: tab open");
  });

  it.each([
    { args: ["list"] },
    { args: ["close"] },
    { args: ["show"] },
    { args: ["replace", "tab-known"] },
  ])("prints the usage for $args", async ({ args }) => {
    const result = await run({}, ...args);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: tab open");
  });
});
