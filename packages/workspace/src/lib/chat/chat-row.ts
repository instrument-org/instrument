import { pick } from "radashi";
import { type z } from "zod";

import { type Chat, ChatSchema } from "./chats";

/**
 * How much of a chat's first message its row carries: enough for a search
 * to find a chat by what it opened with, and short of the whole document a
 * pasted message can be.
 */
const FIRST_ASK_MAX = 1000;

/** How many of each kind of hold a row carries, which a search and the app filter read past the few shown. */
const HOLDS_MAX = 50;

/**
 * A chat as a window's list has it: what the list draws, searches and files
 * by. The process keeps the whole `Chat`, which the phone's file and the
 * process's own readers take what else they need from.
 */
export const ChatRowSchema = ChatSchema.omit({
  // What the process reads of a chat that no window does.
  createdAt: true,
  lastAsk: true,
  lastReplyAt: true,
  ownStep: true,
  ownWorking: true,
  runningTasks: true,
  titled: true,
  updatedAt: true,
});

export type ChatRow = z.output<typeof ChatRowSchema>;

/**
 * A chat's row as it goes to a window. A first message or a list of holds
 * longer than any row needs is cut: the files and sites to their newest,
 * which a row shows first, and the apps to those the chat called first.
 */
export function chatRow(chat: Chat): ChatRow {
  const row = pick(chat, ChatRowSchema.keyof().options);
  return {
    ...row,
    firstAsk: row.firstAsk.slice(0, FIRST_ASK_MAX),
    holds: {
      apps: row.holds.apps.slice(0, HOLDS_MAX),
      files: row.holds.files.slice(-HOLDS_MAX),
      sites: row.holds.sites.slice(-HOLDS_MAX),
    },
  };
}
