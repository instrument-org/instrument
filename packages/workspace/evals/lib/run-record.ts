import fs from "node:fs";
import path from "node:path";

/**
 * What `report <dir>` needs to know about a run it did not watch, kept in
 * the run's own workspace: which case, model and trial a chat was, the
 * session the case's prompt went to, and the home the run gave its agents.
 *
 * Read from nothing else, because nothing else holds it reliably. A chat's
 * title is the app's to change (the first exchange retitles it, a topic's
 * send titles it from the prompt), and an assertion that reads a file under
 * the home reads the wrong one in a process whose home is not the run's.
 *
 * Imports nothing of the app's, since `sandbox-home.ts` reads it before
 * anything else may read the home.
 */

/**
 * Where a run keeps what the app keeps on this computer for its workspace,
 * each chat's work folder among it: inside the run's own folder, so a saved
 * run carries both halves of every chat. App data no chat reads, which is
 * why a run's records go there too.
 */
export const EVAL_MACHINE_DIR_NAME = "machine";

export interface RunRecord {
  chatId: string;
  /** The home the run gave every agent in it (`sandbox-home.ts`). */
  home: string;
  modelLabel: string;
  name: string;
  /** The session the case's prompt went to: the chat's, or the task's. */
  sessionId: string;
  trial: number;
}

function recordsDir(workspaceRootDir: string): string {
  return path.join(workspaceRootDir, EVAL_MACHINE_DIR_NAME, "eval-runs");
}

export async function recordRun(
  workspaceRootDir: string,
  record: RunRecord,
): Promise<void> {
  const dir = recordsDir(workspaceRootDir);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(
    path.join(dir, `${record.chatId}.json`),
    JSON.stringify(record, null, 2),
    "utf8",
  );
}

/** Absent for a run recorded before runs were, or a chat no run made. */
export async function readRunRecord(
  workspaceRootDir: string,
  chatId: string,
): Promise<RunRecord | undefined> {
  const text = await fs.promises
    .readFile(path.join(recordsDir(workspaceRootDir), `${chatId}.json`), "utf8")
    .catch(() => undefined);
  // Written by `recordRun` above.
  return text === undefined ? undefined : (JSON.parse(text) as RunRecord);
}

/** The home a past run's agents had, from any of its records. */
export function recordedHome(workspaceRootDir: string): string | undefined {
  const dir = recordsDir(workspaceRootDir);
  try {
    const [first] = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"));
    if (!first) {
      return undefined;
    }
    // Written by `recordRun` above.
    const record = JSON.parse(
      fs.readFileSync(path.join(dir, first), "utf8"),
    ) as RunRecord;
    return record.home;
  } catch {
    return undefined;
  }
}
