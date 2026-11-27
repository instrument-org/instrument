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

const COMMAND = "systemsetup -settimezone America/New_York";

/** An admin card for COMMAND in a column `width` wide, raised on this computer or another. */
async function showAdminCard(width: number, { here = true } = {}) {
  const sendMessage = vi.fn();
  const { queryClient } = await renderInBrowser(
    <div style={{ width }}>
      <PermissionAsksFoot chatId={chatId} sendMessage={sendMessage} />
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
            reason: "Changes this Mac’s time zone to Eastern Time.",
            sessionId: StoreId.newSessionId(),
          },
        ],
        computer: "Studio Mac",
        device: DeviceIdSchema.parse("dev_MAC00000"),
        here,
        id: "ask-0",
        kind: "admin",
        status: "open",
        target: COMMAND,
      },
    ],
  );
  await vi.waitFor(() => {
    if (!document.querySelector("[data-admin-ask]")) {
      throw new Error("the card has not drawn yet");
    }
  });
  return { sendMessage };
}

const button = (name: string) => {
  const found = [...document.querySelectorAll("button")].find(
    (each) => each.textContent === name,
  );
  if (!found) {
    throw new Error(`no button “${name}”`);
  }
  return found;
};

const LINKS = [
  "What does this do?",
  "Try without administrator",
  "I’ll run it myself",
];

describe("the admin card's other choices", () => {
  it("puts the three links in a row under the answers", async () => {
    await showAdminCard(600);
    const rects = LINKS.map((name) => button(name).getBoundingClientRect());
    const answers = button("Run as administrator").getBoundingClientRect();
    for (const rect of rects) {
      expect(rect.top).toBe(rects[0]?.top);
      expect(rect.height).toBe(28);
      expect(rect.top).toBeGreaterThan(answers.bottom);
    }
    expect(rects.map((rect) => rect.left)).toEqual(
      rects.map((rect) => rect.left).toSorted((a, b) => a - b),
    );
  });

  it("stacks the answers full width and the links a line each when narrow", async () => {
    await showAdminCard(300);
    const run = button("Run as administrator").getBoundingClientRect();
    const decline = button("Don’t allow").getBoundingClientRect();
    expect(decline.width).toBe(run.width);
    expect(decline.top).toBeGreaterThan(run.bottom);
    const rects = LINKS.map((name) => button(name).getBoundingClientRect());
    for (const [index, rect] of rects.entries()) {
      expect(rect.height).toBe(28);
      expect(rect.left).toBe(rects[0]?.left);
      expect(rect.top).toBeGreaterThan(
        index === 0 ? decline.bottom : (rects[index - 1]?.top ?? 0),
      );
    }
  });

  it("gives the links a line each before they would wrap", async () => {
    await showAdminCard(460);
    const rects = LINKS.map((name) => button(name).getBoundingClientRect());
    expect(new Set(rects.map((rect) => rect.left)).size).toBe(1);
    expect(new Set(rects.map((rect) => rect.top)).size).toBe(3);
  });

  it("sends What does this do? as the person's message and keeps the card", async () => {
    const { sendMessage } = await showAdminCard(600);
    button("What does this do?").click();
    expect(sendMessage).toHaveBeenCalledWith("What does this do?");
    expect(button("Run as administrator")).toBeDefined();
  });

  it("copies the command with sudo, waits for Done, and Back undoes it", async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    await showAdminCard(600);
    button("I’ll run it myself").click();
    await vi.waitFor(() => button("Done"));
    expect(writeText).toHaveBeenCalledWith(`sudo ${COMMAND}`);
    expect(
      document.querySelector("[data-admin-command] pre")?.textContent,
    ).toBe(`sudo ${COMMAND}`);
    expect(document.body.textContent).toContain(
      "Command copied. Paste it in Terminal, then choose Done.",
    );
    expect(() => button("Run as administrator")).toThrow();
    expect(() => button("Try without administrator")).toThrow();

    button("Back").click();
    await vi.waitFor(() => button("Run as administrator"));
    expect(
      document.querySelector("[data-admin-command] pre")?.textContent,
    ).toBe(COMMAND);
    expect(button("I’ll run it myself")).toBeDefined();
    writeText.mockRestore();
  });

  it("leaves running it by hand to the computer it runs on", async () => {
    await showAdminCard(600, { here: false });
    expect(button("What does this do?")).toBeDefined();
    expect(button("Try without administrator")).toBeDefined();
    expect(() => button("I’ll run it myself")).toThrow();
  });
});
