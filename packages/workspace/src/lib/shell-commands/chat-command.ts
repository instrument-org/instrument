import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the chat's `instrument chat` command, kept
 * apart from the command itself so prompt text can name it without importing
 * the workspace machinery the command runs against.
 */
export const CHAT_COMMAND = {
  description:
    "Read the user's other chats: `instrument chat list [--topic <name>] [-n <count>]` lists them with where each stands, `instrument chat read <id or title words> [--tail <n>]` reads the end of one, `instrument chat search <words>` finds a line across all of them, `instrument chat topics` names the topics, `instrument chat tag <chat> <topic>` files a chat under one. The chat you are in is in front of you; these are for the others.",
  name: `${INSTRUMENT_COMMAND.name} chat`,
  summary: "Read the user's other chats.",
  word: "chat",
} as const;
