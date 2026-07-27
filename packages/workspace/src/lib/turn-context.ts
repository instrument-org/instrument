import { AsyncLocalStorage } from "node:async_hooks";
import { monotonicFactory } from "ulid";
import { z } from "zod";

import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";

const ulid = monotonicFactory();

/**
 * Identifies one agent turn. Minted per `beginTurn` and never persisted: it
 * exists so work started during a turn can prove which turn it belongs to, even
 * after that turn ended and the next one started on the same session.
 */
const TurnIdSchema = z.string().brand("TurnId");

/** The turn a piece of work belongs to, and the session that owns the report. */
export interface TurnContext {
  id: TaskId;
  sessionId: StoreId.Session;
  turnId: TurnId;
}

export type TurnId = z.output<typeof TurnIdSchema>;

/** A task and session. What a caller knows before the turn is looked up. */
export interface TurnKey {
  id: TaskId;
  sessionId: StoreId.Session;
}

/** Task and session -> the turn currently running for it, if any. */
const ACTIVE_TURNS = new Map<string, TurnId>();
const TURN_CONTEXT = new AsyncLocalStorage<TurnContext>();

/**
 * Starts a turn and returns its id.
 *
 * The workspace holds a single process-wide registry rather than threading the
 * turn through every call, because the code that needs to know the turn -- the
 * shared write boundaries -- sits many frames below the agent loop and takes no
 * session argument. `withTurnContext` is the only way that registry reaches
 * them, so nothing outside a tool call can observe a turn.
 */
export function beginTurn(turn: TurnKey): TurnId {
  const turnId = TurnIdSchema.parse(`trn_${ulid()}`);
  ACTIVE_TURNS.set(turnKey(turn), turnId);
  return turnId;
}

/** Ends the turn for a task and session. Safe to call when none is running. */
export function endTurn(turn: TurnKey): void {
  ACTIVE_TURNS.delete(turnKey(turn));
}

/**
 * The turn the calling code is running under, or undefined outside a tool call.
 * Callers must treat undefined as "do not attribute" rather than falling back
 * to a current-turn lookup: a continuation left over from a finished turn still
 * carries that turn's context, and guessing would bill it to the wrong turn.
 */
export function getTurnContext(): TurnContext | undefined {
  return TURN_CONTEXT.getStore();
}

export function turnKey({ id, sessionId }: TurnKey): string {
  return `${id}:${sessionId}`;
}

/**
 * Runs a tool call bound to the turn that owns it.
 *
 * Nested execution keeps the outer turn. When a tool spawns a sub-agent, that
 * sub-agent's own tool calls run inside this scope on a different session, but
 * the work still belongs to the turn the user started -- that is the turn whose
 * end-of-turn report they are reading, and the session they are looking at.
 * Attributing it to the inner session would strand the report inside a
 * sub-agent nobody has open.
 */
export function withTurnContext<T>(turn: TurnKey, callback: () => T): T {
  const inherited = TURN_CONTEXT.getStore();
  if (inherited) {
    return callback();
  }
  const turnId = getActiveTurnId(turn);
  if (!turnId) {
    // Nothing is tracking this session (a replay, or a tool run outside the
    // agent loop). Leave the store empty so recorders no-op.
    return callback();
  }
  return TURN_CONTEXT.run({ ...turn, turnId }, callback);
}

function getActiveTurnId(turn: TurnKey): TurnId | undefined {
  return ACTIVE_TURNS.get(turnKey(turn));
}
