import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { CHAT_FILE_NAME, HANDOFF_NOTES_FILE_NAME } from "../constants";
import { type ChatId } from "../schemas/chat-id";
import { type AbsolutePath, AbsolutePathSchema } from "../schemas/paths";
import { handoffNotesPath } from "./chat-dir-utils";
import { chatFolderTheyOpen } from "./chat/output-folder";
import { chatDir, chatOwnFolder } from "./record-folders";
import { truncateWithoutSplitting } from "./sanitize-model-text";
import { shellPath } from "./workspace-fs-layout";

/**
 * Where a chat's handoff notes live, as the agent spells it, named once for
 * both halves of the handoff.
 *
 * The agent is told to write here and the assembler reads from here, from
 * this one path, because the first version of this feature let each side
 * decide for itself and they did not agree. Told only that its working
 * directory outlives the conversation, an agent wrote `work/handoff-notes.md`
 * on one run and `work/handoff.md` on the next, and nothing downstream could
 * look for a name chosen fresh each time.
 *
 * In the chat's record folder (`handoffNotesPath`), the one file there the
 * agent may write: the notes are the agent's own record of the conversation,
 * not a deliverable the user asked for, and they go wherever it goes.
 */
export function agentHandoffNotesPath(chatId: ChatId): string {
  return shellPath(notesPathFor(chatId));
}

/**
 * The chat's whole conversation as the agent spells it: the `CHAT.md` the app
 * writes in the chat's own folder after every reply. Undefined for a chat
 * with no folder the person opens, which has no transcript to point at.
 */
export function agentTranscriptPath(chatId: ChatId): string | undefined {
  const own = chatFolderTheyOpen(chatOwnFolder(chatDir(chatId)));
  return own === undefined
    ? undefined
    : shellPath(AbsolutePathSchema.parse(path.join(own, CHAT_FILE_NAME)));
}

/**
 * Where a chat's handoff notes are: its own folder under `Chats/`, beside
 * the transcript and what it made, and the record folder for a chat whose
 * folder is not one the person opens or that has no folder yet.
 *
 * They moved out of the record folder because `.instrument/` closes to the
 * agent entirely, and these are the one file in there it wrote. A person
 * reading the folder meets them as what they are, the agent's own notes on
 * the conversation, rather than as something hidden from them.
 *
 * The agent writes this file itself, so it has to be somewhere it may
 * write: a workspace in the app's own data is a place the rules ask about,
 * and the notes are the one thing it has to be able to write without
 * anyone being there to answer. See `finishedWorkFolder`.
 */
function notesPathFor(chatId: ChatId): AbsolutePath {
  const own = chatFolderTheyOpen(chatOwnFolder(chatDir(chatId)));
  return own === undefined
    ? handoffNotesPath(chatDir(chatId))
    : AbsolutePathSchema.parse(path.join(own, HANDOFF_NOTES_FILE_NAME));
}

/**
 * Characters of notes carried into a request after a rollover.
 *
 * Bounded because this rides on every request for the rest of the session, and
 * a note that grew without limit would reintroduce the growth the rollover just
 * reclaimed. Generous against what handoff notes actually run to, which is a
 * few hundred to a few thousand characters.
 */
const MAX_NOTES_CHARACTERS = 8000;

/**
 * What the agent is handed once its own earlier turns have stopped being sent.
 *
 * The notes are inlined rather than pointed at, which is the whole lesson of
 * the version this replaces. Told where its notes were and to go and read them,
 * an agent mid-task did not: it costs a tool call and a decision, against a
 * user message right in front of it asking for something else. What arrives in
 * the request costs neither.
 *
 * Derived per request and never persisted, so it tracks the file as the agent
 * rewrites it, and appended after the cache breakpoints so its contents cannot
 * move the cached prefix.
 */
export function contextRolloverNotice(
  notes: string | undefined,
  notesPath: string,
  summarized?: { summary: string; transcriptPath: string | undefined },
): string {
  const carried =
    "The user's messages have been carried across newest first, up to a size budget: older ones may have been dropped whole, and a bracketed [context rollover omitted ...] line stands where the middle of an oversized one was cut. Treat a line like that, or an earlier instruction you cannot find, as something to ask the user about rather than something that never existed.";
  const preamble =
    summarized === undefined
      ? `This conversation ran out of context and continued in a fresh window. ${carried} Your own earlier turns have not been carried across at all: the work you did, what you read, and anything you worked out before the cut are no longer in front of you.`
      : `This conversation was summarized to keep it small, and continued in a fresh window. ${carried} Your own earlier turns are replaced by the summary below, which you wrote at the cut: treat what it says as established rather than something to rediscover.${summarized.transcriptPath === undefined ? "" : ` The whole conversation so far is in \`${summarized.transcriptPath}\`, if a detail the summary left out matters.`}`;
  const summary =
    summarized === undefined
      ? []
      : ["", "<summary>", summarized.summary, "</summary>"];

  if (notes === undefined) {
    return [
      "<context-rollover>",
      preamble,
      ...summary,
      "",
      `No handoff notes were found at \`${notesPath}\`. Treat what is in this window as the remainder of the task rather than the whole of it, and write your notes there before the room runs out again.`,
      "</context-rollover>",
    ].join("\n");
  }

  return [
    "<context-rollover>",
    preamble,
    ...summary,
    "",
    `These are the handoff notes you left at \`${notesPath}\`. They are your own account of the work above, and the only one still in front of you, so treat what they say about the task as established rather than something to rediscover:`,
    "",
    notes,
    "",
    `Keep them current at \`${notesPath}\` as the task moves.`,
    "</context-rollover>",
  ].join("\n");
}

/**
 * What the agent left for whoever continues the task, if anything.
 *
 * Read at assembly time rather than carried in the transcript, because the
 * notes are a file the agent rewrites as the task moves and the freshest
 * version is the one worth sending. Absent, unreadable, or empty all return
 * undefined and say nothing: this augments a request, and no request should
 * fail because a note the agent may never have written is not there. Nor is
 * a link read through, since the file sits beside the chat's records and the
 * agent may put anything at its name: it is opened once, refusing a link
 * (`O_NOFOLLOW`), and the file opened is the one checked and read, so
 * nothing swapped in between a check and the read is read. The open does not
 * wait (`O_NONBLOCK`), so a pipe put there is passed over rather than held
 * open waiting for a writer.
 */
export async function readHandoffNotes(
  chatId: ChatId,
): Promise<string | undefined> {
  try {
    const handle = await fs.open(
      notesPathFor(chatId),
      // Windows has neither flag, and no sandbox for the agent's programs
      // either, so it reads the file as it finds it.
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    let contents: string;
    try {
      if (!(await handle.stat()).isFile()) {
        return undefined;
      }
      contents = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
    const trimmed = contents.trim();

    if (trimmed === "") {
      return undefined;
    }

    // Truncated with the character-aware cut rather than a plain slice: the
    // notice this feeds is appended after the outgoing sanitize pass, so half
    // an emoji left here would reach the provider on every later request.
    return trimmed.length > MAX_NOTES_CHARACTERS
      ? `${truncateWithoutSplitting(trimmed, MAX_NOTES_CHARACTERS)}\n\n[Notes truncated at ${MAX_NOTES_CHARACTERS.toLocaleString("en-US")} characters.]`
      : trimmed;
  } catch {
    return undefined;
  }
}
