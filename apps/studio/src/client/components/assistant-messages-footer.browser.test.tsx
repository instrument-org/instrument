import {
  DeviceIdSchema,
  type SessionMessage,
  StoreId,
} from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

import { renderInBrowser } from "../../tests/render-browser";
import { AssistantMessagesFooter } from "./assistant-messages-footer";

const sessionId = StoreId.newSessionId();
const messageId = StoreId.newMessageId();

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: {
        undoableReplies: {
          queryOptions: () => ({
            queryFn: () => [
              {
                back: [{ copy: "/v1.svg", file: "/Users/mac-user/turtle.svg" }],
                messageId,
                stay: [],
              },
            ],
            queryKey: ["undoable"],
          }),
        },
      },
    },
  },
}));
vi.mock("@/client/hooks/use-agent-session-status", () => ({
  useAgentSessionStatus: () => ({ isChatRunning: false }),
}));

const reply = {
  id: messageId,
  metadata: {
    createdAt: new Date(Date.now() - 60_000),
    finishedAt: new Date(Date.now() - 48_000),
    finishReason: "stop",
    modelId: "anthropic/claude-haiku-5.5",
    msToFinish: 12_000,
    providerId: "anthropic",
    sessionId,
  },
  parts: [
    {
      data: {
        device: DeviceIdSchema.parse("dev_ABCDEFGH"),
        // The footer asks only whether the reply recorded any.
        files: [],
      },
      metadata: {
        createdAt: new Date(0),
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-fileVersions",
    },
  ],
  role: "assistant",
} satisfies SessionMessage.AssistantWithParts;

describe("AssistantMessagesFooter at narrow widths", () => {
  it.each([
    [560, ["12s", "Claude", "ago"]],
    [440, ["Claude", "ago"]],
    [380, ["ago"]],
    [300, []],
  ] as const)(
    "keeps the row one line at %ipx, showing %j",
    async (width, shown) => {
      const screen = await renderInBrowser(
        <div style={{ width }}>
          <AssistantMessagesFooter
            alwaysVisible
            chatId={"chat" as never}
            messages={[reply]}
          />
        </div>,
      );
      const undo = screen.getByRole("button", { name: "Undo changes" });
      await expect.element(undo).toBeVisible();
      const row = undo.element().closest("[class*='@container/footer']");
      const copy = screen.getByRole("button", { name: "Copy" }).element();
      // One line: Undo sits level with Copy, at the row's far end.
      const at = (element: Element) => element.getBoundingClientRect();
      expect(Math.abs(at(undo.element()).top - at(copy).top)).toBeLessThan(4);
      // The end buttons' negative margins put their icons on the row's
      // edges, a button's padding past each.
      expect(row?.scrollWidth).toBeLessThanOrEqual(width + 4);
      expect(at(undo.element()).right).toBeGreaterThan(width - 12);
      const text = (row as HTMLElement | null)?.innerText ?? "";
      for (const each of ["12s", "Claude", "ago"]) {
        expect({ [each]: text.includes(each) }).toEqual({
          [each]: (shown as readonly string[]).includes(each),
        });
      }
      // A dot between each two items that show, and none left over.
      const visible = (element: Element) => element.getClientRects().length > 0;
      const details = [
        ...(row?.querySelectorAll("div.text-xs > span") ?? []),
      ].filter(visible);
      const dots = [...(row?.querySelectorAll("span[aria-hidden]") ?? [])]
        .filter((dot) => dot.textContent === "·")
        .filter(visible);
      expect(dots.length).toBe(Math.max(0, details.length - 1));
    },
  );
});
