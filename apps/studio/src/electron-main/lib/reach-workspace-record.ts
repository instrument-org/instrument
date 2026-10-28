import { type LostReason } from "@/shared/setup";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import fs from "node:fs/promises";
import path from "node:path";

import { isDataless } from "./dataless";
import { errorCode, lostFor } from "./workspace-refusal";

/** How long setup waits on one read before saying the folder can't be reached. */
const REACH_TIMEOUT_MS = 60_000;

export type ReachedRecord =
  | { code?: string; kind: "lost"; reason: LostReason }
  | { kind: "ready" };

// The read of each record still going, which a second ask joins: a read a
// cloud service is slow to answer can't be called off, and another one
// started beside it would only queue behind it.
const reading = new Map<string, Promise<ReachedRecord>>();

/**
 * Reads the `workspace.json` of the workspace in `dir` off the main thread,
 * which downloads it where a cloud service keeps it by name only, so a
 * folder can be opened without the launch, or the window, waiting on the
 * download. Ready once it reads, or when the folder has none (nothing to
 * clobber); otherwise lost, for the reason the folder step says back. Gives
 * up waiting after `timeoutMs`, and a later ask joins the read still going.
 */
export async function reachWorkspaceRecord(
  dir: string,
  { timeoutMs = REACH_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<ReachedRecord> {
  const record = path.join(workspaceLayout(dir).dataDir, "workspace.json");
  let read = reading.get(record);
  if (read === undefined) {
    read = readOnce(dir, record).finally(() => {
      reading.delete(record);
    });
    reading.set(record, read);
  }
  let timer: NodeJS.Timeout | undefined;
  const waited = new Promise<ReachedRecord>((resolve) => {
    timer = setTimeout(() => {
      resolve(
        isDataless(record)
          ? { kind: "lost", reason: "cloud" }
          : lostFor("ETIMEDOUT"),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([read, waited]);
  } finally {
    clearTimeout(timer);
  }
}

async function readOnce(dir: string, record: string): Promise<ReachedRecord> {
  try {
    if (!(await fs.stat(dir)).isDirectory()) {
      return lostFor("ENOTDIR");
    }
  } catch (error) {
    return lostFor(errorCode(error));
  }
  try {
    await fs.readFile(record);
    return { kind: "ready" };
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") {
      return { kind: "ready" };
    }
    return isDataless(record)
      ? { kind: "lost", reason: "cloud" }
      : lostFor(code);
  }
}
