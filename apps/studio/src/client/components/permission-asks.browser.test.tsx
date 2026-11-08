import { rpcClient } from "@/client/rpc/client";
import {
  ChatIdSchema,
  DeviceIdSchema,
  StoreId,
} from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

import { renderInBrowser } from "../../tests/render-browser";
import { PermissionAsksFoot } from "./permission-asks";

const chatId = ChatIdSchema.parse("test-chat");
const REASON = "The record page asks you to show you are a person first.";

async function showPageWait(width: number) {
  const { queryClient } = await renderInBrowser(
    <div style={{ width }}>
      <PermissionAsksFoot chatId={chatId} />
    </div>,
  );
  queryClient.setQueryData(
    rpcClient.workspace.chats.live.asks.experimental_liveOptions({
      input: { id: chatId },
    }).queryKey,
    [
      {
        answerable: true,
        askedAt: new Date(0),
        askers: [
          {
            at: new Date(0),
            reason: REASON,
            sessionId: StoreId.newSessionId(),
            title: "Clear the human check",
          },
        ],
        computer: "Studio Mac",
        device: DeviceIdSchema.parse("dev_MAC00000"),
        here: true,
        id: "ask-0",
        kind: "page",
        page: { title: "Just a moment...", url: "https://records.example/1" },
        status: "open",
        target: "tab_1",
      },
    ],
  );
  const button = await vi.waitFor(() => {
    const found = document.querySelector<HTMLElement>("[data-page-wait]");
    if (!found) {
      throw new Error("the card has not drawn yet");
    }
    return found;
  });
  const reason = [...button.querySelectorAll("span")].find(
    (span) => span.textContent === REASON,
  );
  return {
    button: button.getBoundingClientRect(),
    reason: reason?.getBoundingClientRect(),
  };
}

describe("the page wait card", () => {
  it("runs its reason under the icon when the card is narrow", async () => {
    const { button, reason } = await showPageWait(340);
    expect(reason?.left).toBe(button.left);
  });

  it("keeps its reason beside the icon when there is room", async () => {
    const { button, reason } = await showPageWait(600);
    expect(reason?.left).toBeGreaterThan(button.left + 36);
  });
});
