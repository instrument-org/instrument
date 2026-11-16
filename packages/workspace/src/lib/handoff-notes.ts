import { constants } from "node:fs";
import fs from "node:fs/promises";

import { type ChatId } from "../schemas/chat-id";
import { type AbsolutePath } from "../schemas/paths";
import { handoffNotesPath } from "./chat-dir-utils";
import { chatDir } from "./record-folders";
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

function notesPathFor(chatId: ChatId): AbsolutePath {
  return handoffNotesPath(chatDir(chatId));
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
