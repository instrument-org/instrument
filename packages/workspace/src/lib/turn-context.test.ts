import { describe, expect, it } from "vitest";

import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import {
  beginTurn,
  endTurn,
  getTurnContext,
  type TurnKey,
  withTurnContext,
} from "./turn-context";

const taskId = TaskIdSchema.parse("turn-context");

function newTurn(): TurnKey {
  return { id: taskId, sessionId: StoreId.newSessionId() };
}

describe("withTurnContext", () => {
  it("has no context outside a tool call", () => {
    expect(getTurnContext()).toBeUndefined();
  });

  it("has no context when no turn is running for the session", () => {
    const seen = withTurnContext(newTurn(), () => getTurnContext());
    expect(seen).toBeUndefined();
  });

  it("carries the turn across awaits", async () => {
    const turn = newTurn();
    const turnId = beginTurn(turn);

    const seen = await withTurnContext(turn, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return getTurnContext();
    });

    expect(seen).toEqual({ ...turn, turnId });
    endTurn(turn);
  });

  it("keeps each turn's context when two run interleaved", async () => {
    const first = newTurn();
    const second = newTurn();
    const firstId = beginTurn(first);
    const secondId = beginTurn(second);

    // Staggered delays make the two scopes resume inside one another: if the
    // store were shared module state instead of per-scope, the later writer
    // would win and both reads would return the same turn.
    const read = (turn: TurnKey, delayMs: number) =>
      withTurnContext(turn, async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return getTurnContext();
      });
    const [seenFirst, seenSecond] = await Promise.all([
      read(first, 10),
      read(second, 1),
    ]);

    expect(seenFirst?.turnId).toBe(firstId);
    expect(seenSecond?.turnId).toBe(secondId);
    endTurn(first);
    endTurn(second);
  });

  it("keeps the outer turn for work nested inside a tool call", async () => {
    const outer = newTurn();
    const inner = newTurn();
    const outerId = beginTurn(outer);
    beginTurn(inner);

    // The shape a spawned sub-agent takes: its own session, its own turn, but
    // running inside the tool call that spawned it. Its work belongs to the
    // turn the user started.
    const seen = await withTurnContext(outer, async () => {
      await Promise.resolve();
      return withTurnContext(inner, () => getTurnContext());
    });

    expect(seen).toEqual({ ...outer, turnId: outerId });
    endTurn(outer);
    endTurn(inner);
  });

  it("mints a distinct id for each turn on one session", () => {
    const turn = newTurn();
    const first = beginTurn(turn);
    endTurn(turn);
    const second = beginTurn(turn);

    expect(second).not.toBe(first);
    endTurn(turn);
  });

  it("stops binding work once the turn ends", () => {
    const turn = newTurn();
    beginTurn(turn);
    endTurn(turn);

    const seen = withTurnContext(turn, () => getTurnContext());
    expect(seen).toBeUndefined();
  });
});
