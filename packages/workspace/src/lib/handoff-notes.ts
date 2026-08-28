import fs from "node:fs/promises";
import path from "node:path";

import { TASK_FOLDER_NAMES } from "../constants";
import { MOUNT } from "../mount-points";
import { type TaskId } from "../schemas/task-id";
import { taskDir } from "./task-dir-utils";

/**
 * Where a task's handoff notes live, named once for both halves of the handoff.
 *
 * The agent is told to write here and the assembler reads from here, from this
 * one constant, because the first version of this feature let each side decide
 * for itself and they did not agree. Told only that its working directory
 * outlives the conversation, an agent wrote `work/handoff-notes.md` on one run
 * and `work/handoff.md` on the next, and nothing downstream could look for a
 * name chosen fresh each time.
 *
 * Under `work/` rather than `output/`: these are the agent's own working
 * record, not a deliverable the user asked for.
 */
const HANDOFF_NOTES_RELATIVE_PATH = `${TASK_FOLDER_NAMES.work}/handoff-notes.md`;

/** The path as the agent sees it, for prompts and notices. */
export const HANDOFF_NOTES_PATH = `${MOUNT.task}/${HANDOFF_NOTES_RELATIVE_PATH}`;

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
export function contextRolloverNotice(notes: string | undefined): string {
  const preamble =
    "This conversation ran out of context and continued in a fresh window. Everything the user said has been carried across in full. Your own earlier turns have not: the work you did, what you read, and anything you worked out before the cut are no longer in front of you.";

  if (notes === undefined) {
    return [
      "<context-rollover>",
      preamble,
      "",
      `No handoff notes were found at ${HANDOFF_NOTES_PATH}. Treat what is in this window as the remainder of the task rather than the whole of it, and write your notes there before the room runs out again.`,
      "</context-rollover>",
    ].join("\n");
  }

  return [
    "<context-rollover>",
    preamble,
    "",
    `These are the handoff notes you left at ${HANDOFF_NOTES_PATH}. They are your own account of the work above, and the only one still in front of you, so treat what they say about the task as established rather than something to rediscover:`,
    "",
    notes,
    "",
    `Keep them current at ${HANDOFF_NOTES_PATH} as the task moves.`,
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
 * fail because a note the agent may never have written is not there.
 */
export async function readHandoffNotes(
  taskId: TaskId,
): Promise<string | undefined> {
  try {
    const contents = await fs.readFile(
      path.join(taskDir(taskId), HANDOFF_NOTES_RELATIVE_PATH),
      "utf8",
    );
    const trimmed = contents.trim();

    if (trimmed === "") {
      return undefined;
    }

    return trimmed.length > MAX_NOTES_CHARACTERS
      ? `${trimmed.slice(0, MAX_NOTES_CHARACTERS)}\n\n[Notes truncated at ${MAX_NOTES_CHARACTERS.toLocaleString("en-US")} characters.]`
      : trimmed;
  } catch {
    return undefined;
  }
}
