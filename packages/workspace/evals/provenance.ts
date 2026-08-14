/**
 * What a result directory has to carry to be readable later.
 *
 * A run's numbers only mean something next to the prompt they measured, and
 * that pairing has so far lived in whoever was watching the run. Results
 * outlast that: a directory from last week is still on disk, still parses, and
 * cannot say whether the prompt it scored is the one on disk now.
 *
 * Two records, because they fail differently. The commit says where the tree
 * was; it is coarse, and it is wrong whenever a run measured an edit that had
 * not been committed yet, which is the ordinary way a prompt change gets
 * measured. The digest of the system prompt actually sent covers exactly that
 * case and nothing else, and disagreeing digests within one run say the prompt
 * moved mid-run.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import { type Session } from "../src/schemas/session";

const run = promisify(execFile);

export interface GitProvenance {
  branch?: string;
  commit: string;
  /**
   * Tracked files differ from the commit. Untracked ones are ignored on
   * purpose: this repo's tree nearly always holds an untracked plan or review,
   * and a flag that is always true answers nothing.
   */
  dirty: boolean;
}

/**
 * Absent rather than thrown when git cannot answer. A result directory with no
 * commit in it is worse than one with, and worth strictly less than a run that
 * refused to start over its own bookkeeping.
 */
export async function gitProvenance(
  cwd: string,
): Promise<GitProvenance | undefined> {
  const git = async (args: string[]) => {
    const { stdout } = await run("git", args, { cwd });
    return stdout.trim();
  };
  try {
    const [commit, branch, changed] = await Promise.all([
      git(["rev-parse", "HEAD"]),
      git(["rev-parse", "--abbrev-ref", "HEAD"]),
      git(["status", "--porcelain", "--untracked-files=no"]),
    ]);
    return {
      // Detached HEAD reports the string "HEAD", which names nothing.
      branch: branch === "HEAD" ? undefined : branch,
      commit,
      dirty: changed !== "",
    };
  } catch {
    return undefined;
  }
}

/**
 * The system prompt as the model received it, hashed.
 *
 * Read from the session rather than rendered again here, so it is the prompt
 * the run actually used and not what the current checkout would produce. A
 * session persists its context once and reuses it across turns, so one run has
 * one of these unless the context was rebuilt part way through.
 */
export function systemPromptDigest(
  sessions: Session.WithMessagesAndParts[],
): string | undefined {
  const text = sessions
    .flatMap((session) => session.messages)
    .filter(
      (message) =>
        message.role === "session-context" &&
        message.metadata.realRole === "system",
    )
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "text" ? [part.text] : [],
      ),
    )
    .join("\n");
  return text === ""
    ? undefined
    : createHash("sha256").update(text, "utf8").digest("hex");
}
