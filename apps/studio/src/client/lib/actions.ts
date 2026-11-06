import { type RPCOutput } from "@/client/rpc/client";
import { type WindowActionKind } from "@/shared/actions";

/** One line of the action log, as the main process reads it back. */
type Action = RPCOutput["actions"]["list"]["actions"][number];

/**
 * Something the person did that only a window sees, as it tells the main
 * process: one of the kinds a window may report, without the time, which
 * the log stamps.
 */
export type WindowAction = Action extends infer A
  ? A extends { kind: WindowActionKind }
    ? Omit<A, "at">
    : never
  : never;

/**
 * Tells the action log what the person did. Nothing happens outside
 * Electron, where there is no log.
 */
export function recordWindowAction(action: WindowAction) {
  if (typeof window === "undefined") {
    return;
  }
  window.api.recordAction?.(action);
}
