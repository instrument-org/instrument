import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { ChatIdSchema } from "../../schemas/chat-id";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { readConnection } from "./connection";
import { startAppEvents } from "./events";
import { createMemoryAppsConfig } from "./memory-config";

const woken = vi.hoisted(() =>
  vi.fn((_events: unknown, _ref: unknown, _chatId: string) =>
    Promise.resolve(),
  ),
);

vi.mock(import("../chat/wake"), () => ({ wakeChatForApp: woken }));

const LISBON = ChatIdSchema.parse("2026-10-08-lisbon");
const PORTO = ChatIdSchema.parse("2026-10-09-porto");

/** Says the user answered the ask for Linear, the way the host app does. */
async function answer(event: "connected" | "declined" | "failed") {
  publisher.publish("app.event", { event, name: "Linear", slug: "linear" });
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe("startAppEvents", () => {
  beforeAll(() => {
    // A subscriber for the file's life, as the workspace starts one.
    startAppEvents({} as WorkspaceActorRef);
  });

  beforeEach(async () => {
    woken.mockClear();
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      apps: createMemoryAppsConfig(),
    });
    await getWorkspaceConfig().apps.connections.set("linear", {
      status: "needs-sign-in",
      waitingChats: [LISBON, PORTO],
      updatedAt: 1,
    });
  });

  it.each(["connected", "declined"] as const)(
    "wakes every chat that asked when %s, and takes the asks off",
    async (event) => {
      await answer(event);

      expect(woken.mock.calls.map(([, , chatId]) => chatId)).toEqual([
        LISBON,
        PORTO,
      ]);
      expect(woken).toHaveBeenCalledWith(
        [expect.objectContaining({ event })],
        expect.anything(),
        LISBON,
      );
      expect((await readConnection("linear"))?.waitingChats).toBeUndefined();
    },
  );

  it("keeps the asks after a failure, for the user to try again from a card", async () => {
    await answer("failed");

    expect(woken).toHaveBeenCalledTimes(2);
    expect((await readConnection("linear"))?.waitingChats).toEqual([
      LISBON,
      PORTO,
    ]);
  });

  it("wakes nobody for an app no chat is waiting on", async () => {
    await answer("declined");
    woken.mockClear();

    await answer("connected");

    expect(woken).not.toHaveBeenCalled();
  });
});
