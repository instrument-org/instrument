import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publisher } from "../../rpc/publisher";
import { ChatIdSchema } from "../../schemas/chat-id";
import { WorkDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import {
  type WindowTabAction,
  type WindowTabAnswer,
} from "../../schemas/window-tab";
import { buildWorkspaceFsLayout } from "../workspace-fs-layout";
import { createBookmarksCommand } from "./bookmarks";

const chatId = ChatIdSchema.parse("bookmarks-command-chat");
// As this computer spells it, with a drive on Windows, where a file's
// address carries one.
const chatFolder = path.resolve("/work/chats/bookmarks-command-chat");
const layout = buildWorkspaceFsLayout({
  chatHostRoot: WorkDirSchema.parse(chatFolder),
});
const planUrl = pathToFileURL(path.join(chatFolder, "plan.md")).href;

// How long a call waits on the window, short where a test has none answer.
let windowTimeoutMs = 2000;
vi.mock(import("../chat/window-tab"), async (importOriginal) => ({
  ...(await importOriginal()),
  get WINDOW_TAB_TIMEOUT_MS() {
    return windowTimeoutMs;
  },
}));

/** The bookmarks as the window lists them: the bar's, then All Bookmarks'. */
const LISTED: NonNullable<WindowTabAnswer["bookmarks"]> = [
  {
    kind: "bookmark",
    root: "bar",
    title: "Zendesk pricing",
    url: "https://www.zendesk.com/pricing/",
  },
  { kind: "folder", root: "bar", title: "Competitors" },
  {
    folder: "Competitors",
    kind: "bookmark",
    root: "bar",
    title: "Intercom pricing",
    url: "https://www.intercom.com/pricing",
  },
  {
    kind: "bookmark",
    root: "all",
    title: "plan.md",
    url: planUrl,
  },
  {
    kind: "bookmark",
    root: "all",
    title: "secrets.txt",
    url: pathToFileURL(path.resolve("/elsewhere/secrets.txt")).href,
  },
  {
    kind: "bookmark",
    root: "all",
    title: "",
    url: "https://example.com/",
  },
];

let asked: WindowTabAction[];
let stopAnswering: () => void;

/** A window that answers each ask as the app's does, keeping a bookmark once by its address. */
function answeringWindow() {
  const kept = new Set(LISTED.flatMap((each) => each.url ?? []));
  return publisher.subscribe("window.tab", (ask) => {
    asked.push(ask.action);
    const { action } = ask;
    const answer: Omit<WindowTabAnswer, "requestId"> =
      action.kind === "bookmarks"
        ? { bookmarks: LISTED }
        : action.kind === "addBookmark"
          ? {
              bookmark: {
                isNew: !kept.has(action.url),
                kind: "bookmark",
                root: "all",
                title: action.title,
                url: action.url,
              },
            }
          : { error: "not a bookmarks ask." };
    publisher.publish("window.tabDone", {
      id: ask.id,
      requestId: ask.requestId,
      ...answer,
    });
  });
}

function run(options: { role?: "chat" | "task" }, ...args: string[]) {
  const fsTree = new InMemoryFs();
  fsTree.writeFileSync(`${layout.chat.shellRoot}/notes/plan #2.md`, "# plan");
  return createBookmarksCommand({
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
  windowTimeoutMs = 2000;
  stopAnswering = answeringWindow();
});

afterEach(() => {
  stopAnswering();
});

describe("bookmarks list", () => {
  it("lists the bar, then All Bookmarks, by folder, a file by the path the agent reads it at", async () => {
    const result = await run({});

    expect(result.exitCode).toBe(0);
    expect(asked).toEqual([{ kind: "bookmarks" }]);
    expect(result.stdout.replaceAll(layout.chat.shellRoot, "<chat>"))
      .toMatchInlineSnapshot(`
      "Bookmarks bar:
        Zendesk pricing  https://www.zendesk.com/pricing/
        Competitors/
          Intercom pricing  https://www.intercom.com/pricing
      All Bookmarks:
        plan.md  <chat>/plan.md
        secrets.txt  a file outside your folders
        https://example.com/
      "
    `);
  });

  it("keeps only what has every word, with the folder each is in", async () => {
    const result = await run({}, "list", "PRICING", "inter");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "Bookmarks bar:
        Competitors/
          Intercom pricing  https://www.intercom.com/pricing
      "
    `);
    expect(
      (await run({}, "list", "plan")).stdout.replaceAll(
        layout.chat.shellRoot,
        "<chat>",
      ),
    ).toMatchInlineSnapshot(`
      "All Bookmarks:
        plan.md  <chat>/plan.md
      "
    `);
    expect((await run({}, "list", "nothing")).stdout).toMatchInlineSnapshot(`
      "No bookmarks match.
      "
    `);
  });

  it("lists for a task too", async () => {
    const result = await run({ role: "task" }, "list", "zendesk");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Zendesk pricing");
  });

  it("says so when no window answers", async () => {
    stopAnswering();
    windowTimeoutMs = 20;
    const result = await run({}, "list");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument bookmarks: the window did not answer, so no bookmark was read.
      "
    `);
  });
});

describe("bookmarks add", () => {
  it("asks the window to keep a page, under the title given", async () => {
    const result = await run(
      {},
      "add",
      "https://example.org/docs",
      "Example",
      "docs",
    );

    expect(result.exitCode).toBe(0);
    expect(asked).toEqual([
      {
        kind: "addBookmark",
        title: "Example docs",
        url: "https://example.org/docs",
      },
    ]);
    expect(result.stdout).toMatchInlineSnapshot(`
      "Bookmarked "Example docs" in All Bookmarks.
      "
    `);
  });

  it("keeps a file or a folder by its address on this computer, under its own name", async () => {
    const file = await run({}, "add", "notes/plan #2.md");
    const folder = await run({}, "add", "notes");

    expect(file.exitCode).toBe(0);
    expect(folder.exitCode).toBe(0);
    expect(asked).toEqual([
      {
        kind: "addBookmark",
        title: "plan #2.md",
        url: pathToFileURL(path.join(chatFolder, "notes/plan #2.md")).href,
      },
      {
        kind: "addBookmark",
        title: "notes",
        url: `${pathToFileURL(path.join(chatFolder, "notes")).href}/`,
      },
    ]);
    expect(file.stdout.replaceAll(layout.chat.shellRoot, "<chat>"))
      .toMatchInlineSnapshot(`
      "Bookmarked "plan #2.md" in All Bookmarks.
      "
    `);
  });

  it("says where an address kept already is", async () => {
    const result = await run({}, "add", "https://example.com/");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "Already bookmarked as "https://example.com/" in All Bookmarks.
      "
    `);
  });

  it.each([
    ["missing.md", `"missing.md" does not exist.`],
    ["instrument://tab/tab_abc", "names nothing a bookmark opens."],
  ])("refuses %s, asking the window nothing", async (arg, said) => {
    const result = await run({}, "add", arg);

    expect(result.exitCode).toBe(1);
    expect(asked).toEqual([]);
    expect(result.stderr).toContain(said);
  });

  it("is the chat's alone", async () => {
    const result = await run({ role: "task" }, "add", "https://example.org/");

    expect(result.exitCode).toBe(1);
    expect(asked).toEqual([]);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument bookmarks: only the chat adds to the user's bookmarks. Say in your report what the chat should bookmark.
      "
    `);
  });
});
