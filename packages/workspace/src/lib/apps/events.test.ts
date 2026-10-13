import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { ChatIdSchema } from "../../schemas/chat-id";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { readConnection } from "./connection";
import { startAppEvents } from "./events";
import { createMemoryAppsConfig } from "./memory-config";

const woken = vi.hoisted(() => vi.fn());

vi.mock(import("../chat/wake"), () => ({ wakeChatForApp: woken }));

const LISBON = ChatIdSchema.parse("2026-10-08-lisbon");

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
      askedIn: LISBON,
      status: "needs-sign-in",
      updatedAt: 1,
    });
  });

  it("wakes the chat that asked, and takes the ask off once it is settled", async () => {
    await answer("connected");

    expect(woken).toHaveBeenCalledWith(
      expect.objectContaining({ type: "data-appEvent" }),
      expect.anything(),
      LISBON,
    );
    expect((await readConnection("linear"))?.askedIn).toBeUndefined();
  });

  it("keeps the ask after a failure, for the user to try again from the card", async () => {
    await answer("failed");

    expect(woken).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      LISBON,
    );
    expect((await readConnection("linear"))?.askedIn).toBe(LISBON);
  });

  it("wakes nobody for an app no chat is waiting on", async () => {
    await answer("declined");
    woken.mockClear();

    await answer("connected");

    expect(woken).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
    );
  });
});
