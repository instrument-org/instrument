import { afterEach, describe, expect, it } from "vitest";

import { publisher } from "../../rpc/publisher";
import { ChatIdSchema } from "../../schemas/chat-id";
import { type LayoutRead } from "../../schemas/group-layout";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { ensureChatSession } from "../create-session";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { saveNote, WAKE_LAYOUT_TIMEOUT_MS } from "./wake-queue";

const READ: LayoutRead = {
  layout: {
    focused: 0,
    group: { id: "group_a" },
    sides: [
      {
        tabs: [
          {
            address: "instrument://chat/this",
            id: "tab_chat",
            isThisChat: true,
            isUp: true,
            kind: "chat",
            title: "Prices",
          },
          {
            address: "https://example.com/",
            id: "tab_page",
            kind: "website",
            title: "Example",
          },
        ],
      },
    ],
  },
  movedIn: {},
  movedOut: {},
};

let stopWindow: (() => void) | undefined;

afterEach(() => {
  stopWindow?.();
  stopWindow = undefined;
});

/** A chat whose app has a window to ask, or none. */
async function wake(name: string, { hasWindow = true } = {}) {
  const chatId = createMockChatConfig(ChatIdSchema.parse(name));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    ...(hasWindow ? { windowForChat: () => 1 } : {}),
  });
  const sessionId = (await ensureChatSession(chatId))._unsafeUnwrap().id;
  const started = Date.now();
  const message = await saveNote(
    chatId,
    sessionId,
    { data: { events: [] }, type: "data-taskEvent" },
    { withLayout: true },
  );
  return {
    took: Date.now() - started,
    types: message.parts.map((part) => part.type),
  };
}

describe("a wake that starts a turn", () => {
  it("asks the chat's window for its group and writes the layout it answers", async () => {
    const asked: unknown[] = [];
    stopWindow = publisher.subscribe("window.tab", (ask) => {
      asked.push(ask.action);
      publisher.publish("window.tabDone", {
        id: ask.id,
        requestId: ask.requestId,
        read: READ,
      });
    });
    expect((await wake("wake-layout-answered")).types).toEqual([
      "data-groupLayout",
      "data-taskEvent",
    ]);
    expect(asked).toEqual([{ kind: "list" }]);
  });

  it("writes no layout when the window does not answer in time, and waits no longer", async () => {
    const { took, types } = await wake("wake-layout-unanswered");
    expect(types).toEqual(["data-taskEvent"]);
    expect(took).toBeGreaterThanOrEqual(WAKE_LAYOUT_TIMEOUT_MS - 50);
    expect(took).toBeLessThan(WAKE_LAYOUT_TIMEOUT_MS + 1500);
  });

  it("writes no layout and waits for nothing when the app has no window", async () => {
    const { took, types } = await wake("wake-layout-no-window", {
      hasWindow: false,
    });
    expect(types).toEqual(["data-taskEvent"]);
    expect(took).toBeLessThan(WAKE_LAYOUT_TIMEOUT_MS);
  });
});
