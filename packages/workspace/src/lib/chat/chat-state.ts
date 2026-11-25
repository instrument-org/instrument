import { z } from "zod";

import { ChatStatusSchema } from "./chat-status";
import { type Chat } from "./chats";

/** Where a chat stands, as its row shows it, for what the agent reads of chats. */
export const ChatStateSchema = z.object({
  archived: z.boolean(),
  /** The day anything last happened in it, YYYY-MM-DD. */
  last_activity: z.string(),
  /**
   * The line under its title: the step it is on while it works, its question
   * while it waits, else its last reply's first words. Absent where the row
   * says only how it stands.
   */
  latest: z.string().optional(),
  starred: z.boolean(),
  status: ChatStatusSchema,
  unread: z.boolean(),
  /** Whether anything of it still moves, its tasks included, whatever its status. */
  working: z.boolean(),
});

export type ChatState = z.output<typeof ChatStateSchema>;

/** A day as a list of chats prints it, YYYY-MM-DD. */
export function day(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The line a chat's row shows under its title, in the words it has there. */
function latestLineOf({ latest, status }: Chat): string | undefined {
  switch (status) {
    case "failed":
    case "limited": {
      return undefined;
    }
    case "working": {
      return latest?.kind === "step" ? latest.text : undefined;
    }
    default: {
      return latest?.text === "" ? undefined : latest?.text;
    }
  }
}

/** A chat's state, read off its row (`listChats`). */
export function chatStateOf(chat: Chat): ChatState {
  const latest = latestLineOf(chat);
  return {
    archived: chat.archived,
    last_activity: day(chat.updatedAt),
    ...(latest === undefined ? {} : { latest }),
    starred: chat.starred,
    status: chat.status,
    unread: chat.unread,
    working: chat.working,
  };
}
