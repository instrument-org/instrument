import { z } from "zod";

/**
 * Who stopped a session's turn: the person, the chat's agent with
 * `instrument task stop`, or the app quitting. One vocabulary for the log's
 * `stop` record, a task's row and event, and a call the stop cut off.
 */
export const StopperSchema = z.enum(["agent", "app", "person"]);

export type Stopper = z.output<typeof StopperSchema>;

/**
 * Who stopped a session's turn, and whether its chat hears about it. Carried
 * on the stop and out again on `session.done`, so the turn the stop ended is
 * the one it describes.
 */
export interface StopNotice {
  by: Stopper;
  /** Whether the chat is told the task was stopped, in a note written into it that starts no turn. */
  wakesChat: boolean;
}
