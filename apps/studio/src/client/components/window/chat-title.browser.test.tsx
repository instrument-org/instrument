import { renderInBrowser } from "@/tests/render-browser";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ChatTitleButton, ChatTitleField } from "./chat-title";
import { type Chat } from "./chats";
import { WindowContext } from "./context";
import { useChatRename } from "./use-chat-rename";

const calls = vi.hoisted(() => ({
  rename: vi.fn(),
  /** Settled by the test, so the sparkle can be seen at work. */
  retitle: vi.fn<() => Promise<{ title?: string }>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: {
        rename: {
          mutationOptions: (options: object) => ({
            ...options,
            mutationFn: (input: unknown) => {
              calls.rename(input);
              return Promise.resolve();
            },
          }),
        },
        retitle: {
          mutationOptions: (options: object) => ({
            ...options,
            mutationFn: () => calls.retitle(),
          }),
        },
      },
    },
  },
}));

const sessionId = StoreId.newSessionId();
const CHAT_ID = ChatIdSchema.parse("2026-09-16-grocery-list");
const TITLE = "Grocery list for the week";

function chat(): Chat {
  const messageId = StoreId.newMessageId();
  const at = new Date(2026, 8, 16, 9, 0);
  return {
    archived: false,
    createdAt: at.getTime(),
    holds: { apps: [], files: [], sites: [] },
    id: CHAT_ID,
    root: {
      id: messageId,
      metadata: { createdAt: at, sessionId },
      parts: [
        {
          metadata: {
            createdAt: at,
            id: StoreId.newPartId(),
            messageId,
            sessionId,
          },
          text: "make me a grocery list",
          type: "text",
        },
      ],
      role: "user",
    },
    runningTasks: [],
    sessionId,
    starred: false,
    state: "idle",
    title: TITLE,
    titled: true,
    topics: [],
    unread: false,
    unreadByUser: false,
    updatedAt: at.getTime(),
  };
}

async function renderTitle() {
  await renderInBrowser(
    <WindowContext
      value={{
        ask: vi.fn(),
        browser: null,
        focusComposer: vi.fn(),
        openPage: vi.fn(),
        openPath: vi.fn(),
        openScreen: vi.fn(),
      }}
    >
      <Title />
    </WindowContext>,
  );
}

/** The title, and the field in its place once renaming starts: the head's menu starts it from Rename, the press stands in for that here. */
function Title() {
  const rename = useChatRename(chat());
  return rename.isEditing ? (
    <ChatTitleField className="text-sm" rename={rename} width={120} />
  ) : (
    <ChatTitleButton className="text-sm" onClick={rename.start} title={TITLE} />
  );
}

describe("ChatTitleField", () => {
  beforeEach(() => {
    calls.rename.mockClear();
  });

  it("opens focused and saves what the user typed on Enter", async () => {
    await renderTitle();
    await userEvent.click(page.getByRole("button", { name: TITLE }));
    const field = page.getByRole("textbox");
    await expect.element(field).toHaveFocus();

    await userEvent.fill(field, "Weekly shop");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => {
      expect(calls.rename).toHaveBeenCalledWith({
        id: CHAT_ID,
        title: "Weekly shop",
      });
    });
  });

  it("names the chat from the sparkle inside the field, keeping the field open until it has", async () => {
    let answer: ((value: { title?: string }) => void) | undefined;
    calls.retitle.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    await renderTitle();
    await userEvent.click(page.getByRole("button", { name: TITLE }));
    await userEvent.click(
      page.getByRole("button", { name: "Name it from the conversation" }),
    );

    await expect.element(page.getByRole("status")).toBeVisible();
    await expect.element(page.getByRole("textbox")).toHaveFocus();
    expect(calls.rename).not.toHaveBeenCalled();

    answer?.({ title: "Weekly grocery shop" });
    await expect
      .element(page.getByRole("button", { name: TITLE }))
      .toBeVisible();
  });
});
