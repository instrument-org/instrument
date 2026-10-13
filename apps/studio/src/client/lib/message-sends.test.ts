import { StoreId, ChatIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

import { createMessageOptions, holdSendsUntilOpened } from "./message-sends";

const { call } = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      message: {
        create: { call, mutationOptions: () => ({}) },
      },
    },
  },
}));

const id = ChatIdSchema.parse("2026-10-01-message-sends");

describe("createMessageOptions", () => {
  it("holds a send into a chat until its opening message settles", async () => {
    call.mockResolvedValue({ sessionId: "unused" });
    const sessionId = StoreId.newSessionId();
    const opened = holdSendsUntilOpened(sessionId);

    const sending = createMessageOptions().mutationFn({
      id,
      modelURI: "test/model",
      prompt: "and another thing",
      sessionId,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(call).not.toHaveBeenCalled();

    opened();
    await sending;
    expect(call).toHaveBeenCalledOnce();
  });

  it("sends at once into a chat that is not opening", async () => {
    call.mockClear();
    call.mockResolvedValue({ sessionId: "unused" });
    await createMessageOptions().mutationFn({
      id,
      modelURI: "test/model",
      prompt: "hello",
      sessionId: StoreId.newSessionId(),
    });
    expect(call).toHaveBeenCalledOnce();
  });
});
