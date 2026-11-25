import { type ChatState } from "../../lib/chat/chat-state";

/** What a chat is doing, in the words a list of chats or tabs says it with. */
const STATUS_WORDS = {
  failed: "stopped by an error",
  idle: undefined,
  limited: "stopped by a usage limit",
  stopped: "stopped by the user",
  waiting: "waiting on the user",
  working: "working",
} as const satisfies Record<ChatState["status"], string | undefined>;

/** Where a chat stands and whether it has been read, as its row marks it. */
export function chatStandingWords(
  chat: Pick<ChatState, "status" | "unread" | "working">,
): string[] {
  const status = STATUS_WORDS[chat.status];
  return [
    ...(status === undefined ? [] : [status]),
    ...(chat.working && chat.status !== "working" ? ["still working"] : []),
    ...(chat.unread ? ["unread"] : []),
  ];
}

/** The line a chat's row shows, on one line. */
export function chatLatestWords({ latest }: Pick<ChatState, "latest">): string {
  return latest === undefined ? "" : latest.replaceAll(/\s+/g, " ").trim();
}
