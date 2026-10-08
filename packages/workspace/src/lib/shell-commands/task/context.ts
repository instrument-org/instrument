import { type ChatId } from "../../../schemas/chat-id";
import { StoreId } from "../../../schemas/store-id";

/** What `task` needs from the `bash` call it runs inside. */
export interface TaskCommandContext {
  /**
   * The `bash` call the command runs in, which a fork it starts leaves out of
   * the conversation it inherits.
   */
  callPartId?: StoreId.Part;
  /** The chat whose tasks these are. Every subcommand is scoped to it. */
  chatId: ChatId;
  /** What is left of the enclosing call's yield window, read when a wait starts. */
  remainingYieldMs: () => number;
  /**
   * The chat this command is running in, recorded on every task it makes so
   * the outcome comes back where it was asked for. Absent where the command is
   * built outside a turn, which leaves a task unattributed rather than wrong.
   */
  sessionId?: StoreId.Session;
}
