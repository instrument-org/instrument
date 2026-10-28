/** Where a chat stands, as its row and its line say it. */
export type ChatState =
  | "failed"
  | "idle"
  | "limited"
  | "stopped"
  | "waiting"
  | "working";

/**
 * Where a chat stands: the one rule every reader of a chat's state goes
 * through.
 *
 * - **working**: something of the chat's is moving. Its own turn, from the
 *   moment a message reaches its session until that turn ends; a task at
 *   work; or a wake on its way to start a turn.
 * - **waiting**: a card or a question waits on the user. It outranks work,
 *   being the part only the user can move along, unless they have written
 *   since it was asked: the turn their message starts is what the chat is on
 *   until it ends.
 * - **stopped**: the user's last action was a Stop of the chat's own turn,
 *   and no turn has started since.
 * - **failed**: the chat's last turn ended in an error, and nothing has been
 *   sent since.
 * - **limited**: the same, when what stopped it was a usage limit (a plan, a
 *   usage window) rather than something going wrong.
 * - **idle**: none of these.
 *
 * `working` comes back beside `state`, which waiting outranks it in: whether
 * anything still moves is what marking the chat unread, naming it, and
 * telling the user it is done each read as it settles.
 */
export function chatStateOf({
  askedAt,
  failed,
  limited,
  ownTurn,
  spokeAt,
  stopped,
  tasksAtWork,
  wakeOnItsWay,
}: {
  /** When the newest of what waits on the user was asked, in ms; none when nothing does. */
  askedAt: number | undefined;
  /** The chat's last turn ended in an error with nothing sent after it. */
  failed: boolean;
  /** The chat's last turn stopped at a usage limit with nothing sent after it. */
  limited: boolean;
  /** The chat's own session has a turn: a message has reached it, and the turn it starts has not ended. */
  ownTurn: boolean;
  /** When the user last sent a message, in ms. */
  spokeAt: number;
  /** The user stopped the chat's own turn, and no turn has started since. */
  stopped: boolean;
  /** A task of the chat's is at work. */
  tasksAtWork: boolean;
  /** A wake is on its way to start a turn in one of the chat's sessions. */
  wakeOnItsWay: boolean;
}): { ownWorking: boolean; state: ChatState; working: boolean } {
  const ownWorking = ownTurn;
  const working = chatWorks({ ownTurn, tasksAtWork, wakeOnItsWay });
  const hasAsk = askedAt !== undefined;
  const state =
    hasAsk && askedAt > spokeAt
      ? "waiting"
      : working
        ? "working"
        : hasAsk
          ? "waiting"
          : stopped
            ? "stopped"
            : failed
              ? "failed"
              : limited
                ? "limited"
                : "idle";
  return { ownWorking, state, working };
}

/**
 * Whether anything of the chat's still moves, the `working` that
 * `chatStateOf` returns beside its state: its own turn, a task at work, or a
 * wake on its way.
 */
export function chatWorks({
  ownTurn,
  tasksAtWork,
  wakeOnItsWay,
}: {
  ownTurn: boolean;
  tasksAtWork: boolean;
  wakeOnItsWay: boolean;
}): boolean {
  return ownTurn || tasksAtWork || wakeOnItsWay;
}
