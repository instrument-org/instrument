import { type WindowTab } from "@/client/atoms/window";
import { commandMenuOpenAtom } from "@/client/atoms/command-menu";
import { renderInBrowser } from "@/tests/render-browser";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { queryOptions } from "@tanstack/react-query";
import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ChatHeader } from "./chat-header";
import { type Chat, type Project } from "./chats";
import { CommandMenu } from "./command-menu";
import { GroupTabContext } from "./group-tab";
import { chatHref } from "./window-href";

// Every query stays pending.
vi.mock("@/client/rpc/client", () => {
  const pending = () => new Promise(() => undefined);
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: pending,
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

vi.mock("@/client/components/window/shell-context", () => ({
  useShell: () => ({
    goToPlace: () => undefined,
    newGroup: () => undefined,
    newTab: () => undefined,
    projects: [],
  }),
}));

vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ setTheme: () => undefined, theme: "system" }),
}));

const ROOFER = ChatIdSchema.parse("2026-11-14-roofer-quotes");

const CHAT: Chat = {
  archived: false,
  firstAsk: "Roofer quotes",
  holds: { apps: [], files: [], sites: [] },
  id: ROOFER,
  lastUserMessageAt: 0,
  sessionId: StoreId.newSessionId(),
  starred: false,
  status: "idle",
  title: "Roofer quotes",
  titleByApp: true,
  unread: false,
  unreadByUser: false,
  working: false,
};

const CHAT_TAB: WindowTab = {
  href: chatHref(ROOFER),
  id: "chat-tab",
  kind: "screen",
};

vi.mock("@/client/components/window/window-tabs", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/client/components/window/window-tabs")
  >()),
  useWindowTabs: () => ({ active: CHAT_TAB, allTabs: [CHAT_TAB] }),
}));

vi.mock(
  "@/client/components/window/chat-list-query",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/client/components/window/chat-list-query")
    >()),
    chatListOptions: () =>
      queryOptions({
        queryFn: () => Promise.resolve([CHAT]),
        queryKey: ["chat-list"],
      }),
  }),
);

/**
 * The chat's head in its tab, and the menu Cmd+K opens over it, opened
 * while the keyboard is in a field of the tab, where a dialog hands it back
 * as it closes.
 */
async function renderChatWithMenu() {
  const store = createStore();
  await renderInBrowser(
    <GroupTabContext
      value={{
        close: () => undefined,
        id: CHAT_TAB.id,
        isShown: true,
        showPage: () => undefined,
        versionsOf: undefined,
      }}
    >
      <ChatHeader
        chat={CHAT}
        onDeleted={() => undefined}
        onNewProject={() => undefined}
        onSetProject={() => undefined}
        projects={[HOUSE]}
      />
      <input aria-label="Reply" />
      <CommandMenu
        openPage={() => undefined}
        openScreen={() => undefined}
        showTab={() => undefined}
      />
    </GroupTabContext>,
    { store },
  );
  await userEvent.click(page.getByRole("textbox", { name: "Reply" }));
  store.set(commandMenuOpenAtom, true);
  await expect.element(page.getByText("This chat")).toBeVisible();
}

// The menu adds no control of its own for a chat: each of these happens in
// the chat's head.
describe("the command menu's actions for the chat in front", () => {
  it("puts the chat's title into its rename field, with the caret", async () => {
    await renderChatWithMenu();
    await userEvent.fill(page.getByRole("combobox"), "rename");
    await expect
      .element(page.getByRole("option", { selected: true }))
      .toMatchTextContent("Rename");
    await userEvent.keyboard("{Enter}");

    const fieldWithCaret = () => {
      const held = document.activeElement;
      return held instanceof HTMLInputElement ? held.value : undefined;
    };
    await expect.poll(fieldWithCaret).toBe("Roofer quotes");
    // Still there once the menu is gone.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(fieldWithCaret()).toBe("Roofer quotes");
  });

  it("opens the project picker in the chat's head", async () => {
    await renderChatWithMenu();
    await userEvent.click(
      page.getByRole("option", { name: "Move to Project…" }),
    );

    await expect.element(page.getByText("House")).toBeVisible();
  });

  it("asks before deleting, in the chat's own dialog", async () => {
    await renderChatWithMenu();
    await userEvent.click(page.getByRole("option", { name: "Delete Chat…" }));

    await expect.element(page.getByText("Delete this chat?")).toBeVisible();
  });
});
