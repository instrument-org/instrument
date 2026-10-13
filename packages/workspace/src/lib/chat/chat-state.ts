/** Where a chat stands, as its row and its line say it. */
export type ChatState = "failed" | "idle" | "limited" | "waiting" | "working";

/**
 * Where a chat stands, from what is known of it this moment: its own agent,
 * its newest turn, the tasks it filed, and a wake on its way. The one rule
 * for whether a chat is working, which its row, marking it unread as it
 * settles, and naming it all read.
 *
 * A task stopped on an ask is running to the machine and stalled to the
 * user, so it does not make the chat work; it makes it wait, unless
 * something else in the chat is moving. The chat's own agent stopped on an
 * ask of its own is the same. A message is written before the agent it
 * starts is running, so a turn starting counts as the chat's own work, and
 * a wake waiting out its debounce is work about to happen.
 */
export function chatStateOf({
  failed,
  hasAsk,
  limited,
  ownAlive,
  ownAsking,
  pendingWake,
  tasks,
  turnStarting,
}: {
  /** The chat's last turn ended in an error with nothing said after it. */
  failed: boolean;
  /** Something of the chat's, its own agent or a task, waits on the user. */
  hasAsk: boolean;
  /** The chat's last turn stopped at a usage limit with nothing said after it. */
  limited: boolean;
  ownAlive: boolean;
  /** The chat's own newest reply asks the user something. */
  ownAsking: boolean;
  pendingWake: boolean;
  tasks: { waiting?: string }[];
  turnStarting: boolean;
}): { ownWorking: boolean; state: ChatState } {
  const ownWorking = (ownAlive && !ownAsking) || turnStarting;
  const working =
    ownWorking || tasks.some((task) => !task.waiting) || pendingWake;
  const state = working
    ? "working"
    : hasAsk
      ? "waiting"
      : failed
        ? "failed"
        : limited
          ? "limited"
          : "idle";
  return { ownWorking, state };
}
