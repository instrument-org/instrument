import { ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { streamTool } from "./stream-tool";
import {
  beginTurn,
  endTurn,
  getTurnContext,
  type TurnId,
} from "./turn-context";

const model = createMockAIGatewayModel();
const taskId = TaskIdSchema.parse("stream-tool");

function makeOptions(sessionId: StoreId.Session) {
  return {
    agentName: "main" as const,
    input: {},
    messageId: StoreId.newMessageId(),
    model,
    partId: StoreId.newPartId(),
    sessionId,
    signal: AbortSignal.timeout(10_000),
    spawnAgent: vi.fn(),
    taskId,
    taskState: {},
  };
}

/** The turn a write boundary would see, sampled after an await. */
async function sampleTurn(): Promise<TurnId | undefined> {
  await Promise.resolve();
  return getTurnContext()?.turnId;
}

describe("streamTool", () => {
  it("binds a plain async tool to its turn", async () => {
    const sessionId = StoreId.newSessionId();
    const turn = { id: taskId, sessionId };
    const turnId = beginTurn(turn);
    const seen: (TurnId | undefined)[] = [];

    const types = [];
    for await (const { type } of streamTool({
      execute: async () => {
        seen.push(await sampleTurn());
        return ok({});
      },
      options: makeOptions(sessionId),
    })) {
      types.push(type);
    }

    expect(types).toEqual(["final"]);
    expect(seen).toEqual([turnId]);
    endTurn(turn);
  });

  it("rebinds the turn on every generator resumption", async () => {
    const sessionId = StoreId.newSessionId();
    const turn = { id: taskId, sessionId };
    const turnId = beginTurn(turn);
    const seen: (TurnId | undefined)[] = [];

    // Each pull resumes the tool after a yield, which is where a binding made
    // only when the generator was created would have been lost.
    const types = [];
    for await (const { type } of streamTool({
      async *execute() {
        for (const step of [1, 2, 3]) {
          seen.push(await sampleTurn());
          yield ok({ step });
        }
      },
      options: makeOptions(sessionId),
    })) {
      types.push(type);
    }

    expect(types).toEqual([
      "preliminary",
      "preliminary",
      "preliminary",
      "final",
    ]);
    expect(seen).toEqual([turnId, turnId, turnId]);
    endTurn(turn);
  });

  it("binds the cleanup of a tool the consumer abandons", async () => {
    const sessionId = StoreId.newSessionId();
    const turn = { id: taskId, sessionId };
    const turnId = beginTurn(turn);
    const seen: (TurnId | undefined)[] = [];

    for await (const { type } of streamTool({
      async *execute() {
        try {
          yield ok({ step: 1 });
          yield ok({ step: 2 });
        } finally {
          seen.push(await sampleTurn());
        }
      },
      options: makeOptions(sessionId),
    })) {
      expect(type).toBe("preliminary");
      break;
    }

    expect(seen).toEqual([turnId]);
    endTurn(turn);
  });

  it("runs a tool with no context when no turn is active", async () => {
    const seen: (TurnId | undefined)[] = [];

    const types = [];
    for await (const { type } of streamTool({
      execute: async () => {
        seen.push(await sampleTurn());
        return ok({});
      },
      options: makeOptions(StoreId.newSessionId()),
    })) {
      types.push(type);
    }

    expect(types).toEqual(["final"]);
    expect(seen).toEqual([undefined]);
  });
});
