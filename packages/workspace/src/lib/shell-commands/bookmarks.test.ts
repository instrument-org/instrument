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
import {
  beginBookmarkChangeTracking,
  consumeBookmarkChanges,
} from "../bookmark-changes";
import { beginTurn, withTurnContext } from "../turn-context";
import {
  type BookmarkChange,
  type BookmarkSide,
} from "../../schemas/bookmark-change";
import { buildWorkspaceFsLayout } from "../workspace-fs-layout";
import { createBookmarksCommand } from "./bookmarks";

const chatId = ChatIdSchema.parse("bookmarks-command-chat");
const turn = { id: chatId, sessionId: StoreId.newSessionId() };
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
    id: "11111111-a",
    kind: "bookmark",
    root: "bar",
    title: "Zendesk pricing",
    url: "https://www.zendesk.com/pricing/",
  },
  { id: "22222222-b", kind: "folder", root: "bar", title: "Competitors" },
  {
    folder: "Competitors",
    id: "33333333-c",
    kind: "bookmark",
    root: "bar",
    title: "Intercom pricing",
    url: "https://www.intercom.com/pricing",
  },
  {
    folder: "Competitors",
    id: "66666666-g",
    kind: "folder",
    root: "bar",
    title: "Clients",
  },
  {
    folder: "Competitors/Clients",
    id: "77777777-h",
    kind: "bookmark",
    root: "bar",
    title: "Acme",
    url: "https://acme.example/",
  },
  {
    id: "44444444-d",
    kind: "bookmark",
    root: "all",
    title: "plan.md",
    url: planUrl,
  },
  {
    id: "55555555-e",
    kind: "bookmark",
    root: "all",
    title: "secrets.txt",
    url: pathToFileURL(path.resolve("/elsewhere/secrets.txt")).href,
  },
  {
    id: "55555555-f",
    kind: "bookmark",
    root: "all",
    title: "",
    url: "https://example.com/",
  },
];

let asked: WindowTabAction[];
let stopAnswering: () => void;

/** What the window says a remove or a rename did; of the rest, nothing. */
function madeBy(
  change: Extract<WindowTabAction, { kind: "changeBookmarks" }>["change"],
): BookmarkChange[] {
  const side = (id: string, title?: string): BookmarkSide => {
    const found = LISTED.find((each) => each.id === id);
    return {
      kind: found?.kind ?? "bookmark",
      order: 0,
      place: "All Bookmarks",
      root: found?.root ?? "all",
      title: title ?? found?.title ?? "",
      ...(found?.url === undefined ? {} : { url: found.url }),
    };
  };
  return change.type === "remove"
    ? change.ids.map((id) => ({ after: null, before: side(id), id }))
    : change.type === "rename"
      ? [
          {
            after: side(change.id, change.title),
            before: side(change.id),
            id: change.id,
          },
        ]
      : [];
}

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
                id: "66666666-g",
                isNew: !kept.has(action.url),
                kind: "bookmark",
                root: "all",
                title: action.title,
                url: action.url,
              },
            }
          : action.kind === "changeBookmarks"
            ? { bookmarkChanges: madeBy(action.change) }
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
    sessionId: turn.sessionId,
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

/** Runs each command as the agent's in one turn, and answers with what the turn's card has. */
async function inTurn(...commands: string[][]) {
  beginTurn(turn);
  beginBookmarkChangeTracking(turn);
  const results = await withTurnContext(turn, async () => {
    const each = [];
    for (const args of commands) {
      each.push(await run({}, ...args));
    }
    return each;
  });
  return { changes: consumeBookmarkChanges(turn), results };
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
          11111111  Zendesk pricing  https://www.zendesk.com/pricing/
          22222222  Competitors/
            33333333  Intercom pricing  https://www.intercom.com/pricing
            66666666  Clients/
              77777777  Acme  https://acme.example/
        All Bookmarks:
          44444444  plan.md  <chat>/plan.md
          55555555  secrets.txt  a file outside your folders
          55555555  https://example.com/
        "
      `);
  });

  it("keeps only what has every word, with the folder each is in", async () => {
    const result = await run({}, "list", "PRICING", "inter");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
      "Bookmarks bar:
        22222222  Competitors/
          33333333  Intercom pricing  https://www.intercom.com/pricing
      "
    `);
    expect(
      (await run({}, "list", "plan")).stdout.replaceAll(
        layout.chat.shellRoot,
        "<chat>",
      ),
    ).toMatchInlineSnapshot(`
      "All Bookmarks:
        44444444  plan.md  <chat>/plan.md
      "
    `);
    expect((await run({}, "list", "acme")).stdout).toMatchInlineSnapshot(`
      "Bookmarks bar:
        22222222  Competitors/
          66666666  Clients/
            77777777  Acme  https://acme.example/
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
      "instrument bookmarks: only the chat changes the user's bookmarks. Say in your report what the chat should change.
      "
    `);
  });
});

describe("bookmarks changes", () => {
  it.each([
    {
      args: ["move", "11111111", "55555555-f", "--to", "competitors"],
      change: {
        ids: ["11111111-a", "55555555-f"],
        to: "22222222-b",
        type: "move",
      },
    },
    {
      args: ["move", "11111111", "--before", "44444444"],
      change: { before: "44444444-d", ids: ["11111111-a"], type: "move" },
    },
    {
      args: ["move", "44444444", "--to", "bar"],
      change: { ids: ["44444444-d"], to: "bar", type: "move" },
    },
    {
      args: ["address", "11111111", "https://example.org/"],
      change: {
        id: "11111111-a",
        type: "setUrl",
        url: "https://example.org/",
      },
    },
    {
      args: ["address", "11111111", "notes/plan #2.md"],
      change: {
        id: "11111111-a",
        type: "setUrl",
        url: pathToFileURL(path.join(chatFolder, "notes/plan #2.md")).href,
      },
    },
    {
      args: ["new-folder", "To", "read", "--in", "bar"],
      change: { root: "bar", title: "To read", type: "newFolder" },
    },
    {
      args: ["new-folder", "Archive", "--in", "competitors"],
      change: {
        folder: "22222222-b",
        root: "all",
        title: "Archive",
        type: "newFolder",
      },
    },
  ])("asks the window: $args", async ({ args, change }) => {
    const { results } = await inTurn(args);

    expect(results[0]?.stderr).toBe("");
    expect(asked.at(-1)).toEqual({ change, kind: "changeBookmarks" });
  });

  it("says what it did and puts it on the turn's card", async () => {
    const { changes, results } = await inTurn(
      ["rename", "11111111", "Zendesk", "plans"],
      ["remove", "11111111", "44444444"],
    );

    expect(
      results
        .map((each) => each.stdout)
        .join("")
        .replaceAll(layout.chat.shellRoot, "<chat>"),
    ).toMatchInlineSnapshot(`
      "Renamed "Zendesk pricing" to "Zendesk plans" (11111111).
      Removed "Zendesk pricing" (11111111) from All Bookmarks.
      Removed "plan.md" (44444444) from All Bookmarks.
      "
    `);
    // The whole turn: how it stood before the rename, and gone.
    expect(
      changes.map(({ after, before, id }) => [id, before?.title, after]),
    ).toEqual([
      ["11111111-a", "Zendesk pricing", null],
      ["44444444-d", "plan.md", null],
    ]);
  });

  it("says nothing on the card of a change that ended where it began", async () => {
    const { changes } = await inTurn(["rename", "11111111", "Zendesk pricing"]);

    expect(changes).toEqual([]);
  });

  it("changes nothing outside a turn, whose card would have Undo", async () => {
    const result = await run({}, "remove", "11111111");

    expect(result.exitCode).toBe(1);
    expect(asked).toEqual([{ kind: "bookmarks" }]);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument bookmarks: bookmarks change only while you are working on a reply, whose card shows the change with Undo. Nothing changed. Run it again in this turn.
      "
    `);
  });

  it.each([
    [["remove", "55555555"], "begins several ids"],
    [["remove", "1111"], "no bookmark or folder has the id"],
    [["remove"], "needs the ids"],
    [["move", "11111111"], "move needs where they go"],
    [["move", "11111111", "--to", "44444444"], "is a bookmark"],
    [
      ["move", "11111111", "--before", "44444444", "--after", "44444444"],
      "one of --before and --after",
    ],
    [["address", "11111111", "missing.md"], "does not exist"],
  ])("refuses %j", async (args, said) => {
    const { results } = await inTurn(args);

    expect(results[0]?.exitCode).toBe(1);
    expect(results[0]?.stderr).toContain(said);
    expect(asked.some((each) => each.kind === "changeBookmarks")).toBe(false);
  });

  it.each([["move"], ["rename"], ["address"], ["new-folder"], ["remove"]])(
    "%s is the chat's alone",
    async (verb) => {
      const result = await run(
        { role: "task" },
        verb,
        "11111111",
        "https://example.org/",
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("only the chat changes");
      expect(asked).toEqual([]);
    },
  );
});
