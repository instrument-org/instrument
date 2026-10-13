/** Where a chat stands, as its row and its line say it. */
export type ChatState = "failed" | "idle" | "stopped" | "waiting" | "working";

/**
 * Where a chat stands, from what is known of it this moment: its own agent,
 * its newest turn, the tasks it filed, what waits on the user, and a wake on
 * its way. The one rule for what a chat's row and line say, and, through
 * `working`, for whether anything of it still moves, which marking it unread
 * and naming it as it settles read.
 *
 * Something waiting on the user (a card, a question of a task's or of its
 * own) is what the chat says while it is open, whatever else still moves:
 * that is the part only the user can move along. A task stopped on an ask is
 * running to the machine and stalled to the user, so it does not count as
 * work; the chat's own agent stopped on an ask of its own is the same. The
 * exception is an ask the user has spoken past: their newer message starts
 * a turn, and the chat says that turn's work until it ends and the ask is
 * all that is left. A message is written before the agent it starts is
 * running, so a turn starting counts as the chat's own work, and a wake
 * waiting out its debounce is work about to happen. At rest, a turn the user
 * stopped says so until the next turn starts.
 */
export function chatStateOf({
  askedAt,
  failed,
  ownAlive,
  ownAsking,
  pendingWake,
  spokeAt,
  stopped,
  tasks,
  turnStarting,
}: {
  /** When the newest of what waits on the user was asked, in ms; none when nothing does. */
  askedAt: number | undefined;
  /** The chat's last turn ended in an error with nothing said after it. */
  failed: boolean;
  ownAlive: boolean;
  /** The chat's own newest reply asks the user something. */
  ownAsking: boolean;
  pendingWake: boolean;
  /** When the user last sent a message, in ms. */
  spokeAt: number;
  /** The chat's last turn ended on the user's Stop. */
  stopped: boolean;
  tasks: { waiting?: string }[];
  turnStarting: boolean;
}): { ownWorking: boolean; state: ChatState; working: boolean } {
  const ownWorking = (ownAlive && !ownAsking) || turnStarting;
  const working =
    ownWorking || tasks.some((task) => !task.waiting) || pendingWake;
  const hasAsk = askedAt !== undefined;
  const state =
    hasAsk && askedAt > spokeAt
      ? "waiting"
      : working
        ? "working"
        : hasAsk
          ? "waiting"
          : failed
            ? "failed"
            : stopped
              ? "stopped"
              : "idle";
  return { ownWorking, state, working };
}
