import { type Draft } from "@/shared/drafts";
import { renderWithProviders } from "@/tests/render";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { queryOptions } from "@tanstack/react-query";
import { fireEvent, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { type Chat, type Project } from "./chats";
import { PaneTabs } from "./pane-tabs";
import { chatHref, newChatHref } from "./window-href";

/** What the menu asked of the window and of main, by name. */
const calls = vi.hoisted(() => ({
  onNewDraftProject: vi.fn(),
  onNewProject: vi.fn(),
  rpc: vi.fn(),
  setChatProject: vi.fn(),
  updateDraft: vi.fn(),
}));

// Every route a call reaches is recorded and answers with a path; every
// query stays pending.
vi.mock("@/client/rpc/client", () => {
  const pending = () => new Promise(() => undefined);
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: (_target, _this, args: unknown[]) => {
        if (path.at(-1) !== "call") {
          return pending();
        }
        calls.rpc(path.slice(0, -1).join("."), args[0]);
        return Promise.resolve("/Users/mac-user/somewhere");
      },
      get(_target, key) {
        if (key === "queryOptions" || key === "experimental_liveOptions") {
          return () => ({ queryFn: pending, queryKey: path });
        }
        if (key === "mutationOptions") {
          return (options: object) => ({ mutationFn: pending, ...options });
        }
        return typeof key === "string" ? procedure([...path, key]) : undefined;
      },
    });
  return { rpcClient: procedure([]) };
});

const HOUSE: Project = {
  color: "#0f9d6e",
  created: new Date(1),
  emoji: "🏠",
  id: "house",
  name: "House",
};

vi.mock("./shell-context", () => ({
  useShell: () => ({
    onNewDraftProject: calls.onNewDraftProject,
    onNewProject: calls.onNewProject,
    projects: [HOUSE],
    setChatProject: calls.setChatProject,
  }),
}));

const FIRST = ChatIdSchema.parse("2026-11-14-first-chat");
const SECOND = ChatIdSchema.parse("2026-11-14-second-chat");

function chat(id: Chat["id"], title: string): Chat {
  return {
    archived: false,
    firstAsk: title,
    holds: { apps: [], files: [], sites: [] },
    id,
    lastUserMessageAt: 0,
    sessionId: StoreId.newSessionId(),
    starred: false,
    status: "idle",
    title,
    titleByApp: true,
    unread: false,
    unreadByUser: false,
    working: false,
  };
}

const CHATS = [chat(FIRST, "First chat"), chat(SECOND, "Second chat")];

vi.mock("./chat-list-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./chat-list-query")>()),
  chatListOptions: () =>
    queryOptions({
      queryFn: () => Promise.resolve(CHATS),
      queryKey: ["chat-list"],
    }),
}));

// Read by the drafts mock as it is made, ahead of the file's own lines.
const DRAFT = vi.hoisted(
  (): Draft => ({
    createdAt: 0,
    id: "draft-1",
    updatedAt: 0,
    words: "Plan the trip",
  }),
);

vi.mock("@/client/drafts/store", async (importOriginal) => {
  const { atom } = await import("jotai");
  return {
    ...(await importOriginal<typeof import("@/client/drafts/store")>()),
    draftsAtom: atom([DRAFT]),
    updateDraftAtom: atom(null, (_get, _set, update: unknown) => {
      calls.updateDraft(update);
    }),
  };
});

/** A group's strip with two chats and a new chat's tab, the third having a draft. */
function strip() {
  renderWithProviders(
    <PaneTabs
      chatTitles={
        new Map([
          [FIRST, "First chat"],
          [SECOND, "Second chat"],
        ])
      }
      chosenId="a"
      isChatWorking={false}
      onClose={() => {}}
      onDuplicate={() => {}}
      onNew={() => {}}
      onSelect={() => {}}
      tabs={[
        { href: chatHref(FIRST), id: "a", kind: "screen" },
        { href: chatHref(SECOND), id: "b", kind: "screen" },
        { href: newChatHref(DRAFT.id), id: "c", kind: "screen" },
      ]}
      taskTitles={new Map()}
    />,
  );
  return screen.getAllByRole("tab");
}

/** Raises a tab's menu and opens one of its submenus. */
async function openSubmenu(tab: HTMLElement | undefined, name: string) {
  if (!tab) {
    throw new Error("no such tab");
  }
  fireEvent.contextMenu(tab);
  fireEvent.click(await screen.findByRole("menuitem", { name }));
}

describe("a chat tab's menu", () => {
  // jsdom has no layout, and so no scrolling a tab into view.
  beforeAll(() => {
    HTMLElement.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    for (const call of Object.values(calls)) {
      call.mockReset();
    }
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
  });

  it("copies the folder paths of the chat it was raised on", async () => {
    const [, second] = strip();

    await openSubmenu(second, "Copy");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Chat Folder Path" }),
    );
    await openSubmenu(second, "Copy");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Work Folder Path" }),
    );

    expect(calls.rpc.mock.calls).toEqual([
      ["utils.chatFolderPath", { id: SECOND }],
      ["utils.chatWorkFolderPath", { id: SECOND }],
    ]);
  });

  it("files the chat it was raised on under a project, or a new one", async () => {
    const [first] = strip();

    await openSubmenu(first, "Project");
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "House" }),
    );
    await openSubmenu(first, "Project");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "New project…" }),
    );

    expect(calls.setChatProject).toHaveBeenCalledExactlyOnceWith(
      FIRST,
      "house",
    );
    expect(calls.onNewProject).toHaveBeenCalledExactlyOnceWith(
      FIRST,
      undefined,
    );
  });

  it("files a new chat's draft under a project from its tab", async () => {
    const [, , draft] = strip();

    await openSubmenu(draft, "Project");
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "House" }),
    );
    await openSubmenu(draft, "Project");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "New project…" }),
    );

    const [[asked]] = calls.updateDraft.mock.calls as [
      [{ id: string; update: (draft: Draft) => Draft }],
    ];
    expect(asked.id).toBe(DRAFT.id);
    expect(asked.update(DRAFT)).toMatchObject({
      projectId: "house",
      projectSource: "chosen",
    });
    expect(calls.onNewDraftProject).toHaveBeenCalledExactlyOnceWith(
      DRAFT.id,
      undefined,
    );
  });
});
