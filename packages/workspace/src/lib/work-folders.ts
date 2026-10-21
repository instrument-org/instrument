import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import { randomInt } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { updateJsonRecordSync } from "./json-record-file";
import { homeDataLayout } from "./workspace-layout";

/**
 * The home folder the flavor's data folder is in, and with it every
 * workspace's work folders: the person's own, or the folder
 * `INSTRUMENT_DATA_HOME` names, which a seeded or clean-room instance a
 * dev tool boots sets so its chats' work stays beside its own data. A
 * production build ignores it, so a stray variable cannot move a person's
 * work folders.
 */
export function dataHome(): string {
  return (
    (process.env.NODE_ENV !== "production" &&
      process.env.INSTRUMENT_DATA_HOME) ||
    os.homedir()
  );
}

const RecordSchema = z.object({
  /** The workspace's folder in the work folders root. */
  name: z.string().min(1),
});

type WorkFoldersRecord = z.output<typeof RecordSchema>;

/** Characters a suffix is made of: lowercase, and no look-alikes. */
const SUFFIX_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const SUFFIX_LENGTH = 4;

/**
 * The names the workspace's folder is tried under, in order: its label with
 * the end of its own id, which is the same on every computer, then with a
 * random suffix, for a second copy of the app opening the same workspace.
 */
function candidateNames(
  label: string,
  workspaceId: string | undefined,
  random: () => string,
): string[] {
  const fromId = workspaceId?.slice(-SUFFIX_LENGTH).toLowerCase();
  return [
    ...(fromId ? [`${label}-${fromId}`] : []),
    ...Array.from({ length: 8 }, () => `${label}-${random()}`),
  ];
}

function randomSuffix(): string {
  return Array.from(
    { length: SUFFIX_LENGTH },
    () => SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)],
  ).join("");
}

function readRecord(machineDir: string): undefined | WorkFoldersRecord {
  try {
    const parsed = RecordSchema.safeParse(
      JSON.parse(
        fs.readFileSync(
          path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.workFolders),
          "utf8",
        ),
      ),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Settles where the workspace's chats work on this computer,
 * `~/.instrument/work/<workspace>/` under {@link dataHome}, and answers the
 * folder.
 *
 * The name is settled once and recorded in the machine folder
 * (`WORKSPACE_MACHINE_ENTRIES.workFolders`), which is keyed by the
 * workspace's registry entry: a workspace renamed or moved keeps its
 * folder, and the name never has to be worked out again. It is claimed by
 * making the folder, which fails where anything is there already, so two
 * workspaces, or two copies of the app, never share one. `label` is the
 * readable part of a name not settled yet, `workspaceId` the workspace's
 * own id, whose end makes the first suffix tried.
 *
 * Nothing here throws: a step that fails is said in what it answers, and
 * the folder is still the workspace's.
 */
export function claimWorkFolders({
  home = dataHome(),
  label,
  machineDir,
  random = randomSuffix,
  workspaceId,
}: {
  home?: string;
  label: () => string;
  machineDir: string;
  random?: () => string;
  workspaceId: () => string | undefined;
}): { done: string[]; workFoldersDir: string } {
  const done: string[] = [];
  const root = homeDataLayout(home).workDir;
  let record = readRecord(machineDir);
  if (record === undefined) {
    const readable = label();
    const names = candidateNames(readable, workspaceId(), random);
    try {
      fs.mkdirSync(root, { recursive: true });
      for (const name of names) {
        try {
          fs.mkdirSync(path.join(root, name));
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          ) {
            continue;
          }
          throw error;
        }
        record = { name };
        const recorded = record;
        updateJsonRecordSync(
          path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.workFolders),
          () => recorded,
        );
        done.push(`work folders are in ${path.join(root, name)}`);
        break;
      }
    } catch (error) {
      done.push(`could not settle the work folders: ${String(error)}`);
    }
    if (record === undefined) {
      // Unclaimed, and so not recorded: the next launch tries again.
      const name = names[0] ?? readable;
      done.push(`work folders are in ${path.join(root, name)} for now`);
      return { done, workFoldersDir: path.join(root, name) };
    }
  }
  return { done, workFoldersDir: path.join(root, record.name) };
}
