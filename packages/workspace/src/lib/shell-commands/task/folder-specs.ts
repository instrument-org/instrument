import { APP_NAME } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { noop } from "radashi";

import { MOUNT, WORKSPACE_SKILLS_MOUNT } from "../../../mount-points";
import { type MountedFolder } from "../../../schemas/mounted-folder";
import { TOOL_NAMES } from "../../../tools/name";
import { readRefusalOf } from "../../read-refusal";
import {
  effectiveFolderAccess,
  folderHoldsWorkspace,
} from "../../workspace-fs-layout";

/**
 * A look inside a folder still waiting on the user's answer to the system's
 * ask: the folder on disk and as the command named it, and the answer, which
 * settles the moment they give it, to nothing when they allowed it and to the
 * reason when they did not.
 */
export interface PendingLook {
  answer: Promise<string | undefined>;
  path: string;
  spec: string;
}

/**
 * `/mnt/Home/Downloads`: the mount, and the folder inside it when the spec
 * names less than the whole mount. The `/mnt/` prefix is optional.
 */
export function parseFolderSpec(spec: string): {
  name: string;
  subpath: string;
} {
  const prefix = `${MOUNT.folders}/`;
  const inside = (spec.startsWith(prefix) ? spec.slice(prefix.length) : spec)
    .replace(/\/+$/, "")
    .trim();
  const [name = "", ...rest] = inside.split("/");
  return { name, subpath: rest.filter(Boolean).join("/") };
}

/**
 * Every folder granted has to be on disk. The path the note named a moment
 * ago can be gone by the time the command runs (a folder renamed in the
 * Finder, a path with a space in it that lost its tail to the shell), and a
 * grant of it would leave a mount that fails at its first `ls`; refusing here
 * hands the conversation the fix instead. The specs are the folders' own, in
 * the same order, so the refusal names what was typed.
 */
export async function requireFoldersOnDisk(
  folders: { path: string }[],
  specs: string[],
): Promise<PendingLook[]> {
  const pending: PendingLook[] = [];
  for (const [index, folder] of folders.entries()) {
    const spec = specs[index] ?? folder.path;
    let stat;
    try {
      stat = await fs.stat(folder.path);
    } catch {
      throw new Error(
        `no folder at "${spec}": nothing is on disk at ${folder.path}. A folder renamed or moved since it was named is under its new name; \`ls\` its parent to see what is there. A path with a space in it needs quotes: '${MOUNT.folders}/<mount>/a folder'.`,
      );
    }
    if (!stat.isDirectory()) {
      throw new Error(
        `"${spec}" is a file, not a folder. Add the folder, and find the file inside it.`,
      );
    }
    const look = await requireReadable(folder.path, spec);
    if (look) {
      pending.push({ answer: look.answer, path: folder.path, spec });
    }
  }
  return pending;
}

/**
 * How long `task folder --add` waits on the user's answer to the system's ask
 * before giving up on it. Most people answer a dialog they were just told
 * about within this, and an answer inside it is reported as what it is: a
 * folder granted, or a refusal with nothing granted.
 */
export const ANSWER_WAIT_MS = 20_000;

/**
 * Waits up to `waitMs` for the looks still pending to be answered, and returns
 * the ones that were not. A refusal inside the wait throws it at once, so the
 * command refuses as it would have had the user declined before it ran.
 */
export async function awaitAnswers(
  looks: PendingLook[],
  waitMs: number,
): Promise<PendingLook[]> {
  if (looks.length === 0) {
    return [];
  }
  const answered = new Set<PendingLook>();
  const all = Promise.all(
    looks.map(async (look) => {
      const reason = await look.answer;
      if (reason !== undefined) {
        throw new Error(reason);
      }
      answered.add(look);
    }),
  );
  // A refusal that comes after the wait is the next run's to report, not
  // this one's.
  void all.catch(noop);
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, waitMs));
  });
  try {
    await Promise.race([all, deadline]);
  } finally {
    clearTimeout(timer);
  }
  return looks.filter((look) => !answered.has(look));
}

/**
 * The folders `task folder --add` names, against the folders the
 * conversation reaches: each a host path inside a mount. A folder is added
 * to be written in, so one that would mount read-only (the home folder
 * whole, which holds the workspace) is refused with the folder to add
 * instead.
 */
export function resolveFolders(
  specs: string[],
  reached: Record<string, MountedFolder.Type>,
): { path: string }[] {
  const byMount = new Map(
    Object.values(reached).map((folder) => [folder.mountName, folder]),
  );
  const available =
    [...byMount.keys()].map((name) => `${MOUNT.folders}/${name}`).join(", ") ||
    "none";
  return specs.map((spec) => {
    const { name, subpath } = parseFolderSpec(spec);
    const folder = byMount.get(name);
    if (!folder && spec.startsWith(`${MOUNT.skills}/`)) {
      throw new Error(
        `"${spec}" needs no grant: skills are written to ${WORKSPACE_SKILLS_MOUNT}/<name>/ as they are.`,
      );
    }
    if (!folder && name === "") {
      throw new Error(
        `"${spec}" is not one of this conversation's folders: a folder is ${MOUNT.folders}/<mount>[/<folder>]. Yours: ${available}.`,
      );
    }
    if (!folder) {
      throw new Error(
        `no folder "${name}" in this conversation. Yours: ${available}; a folder inside one is written ${MOUNT.folders}/<mount>/<folder>. Ask for one outside them with request_folder.`,
      );
    }
    // A folder inside the mount and never one outside it: `..` in the
    // subpath would grant a folder the user never pointed at.
    const root = path.resolve(folder.path);
    const folderPath = subpath ? path.resolve(root, subpath) : root;
    if (folderPath !== root && !folderPath.startsWith(`${root}${path.sep}`)) {
      throw new Error(
        `"${spec}" leaves ${MOUNT.folders}/${name}. A folder inside a mount can be granted, not one outside it.`,
      );
    }
    // Judged for the folder named, not for the mount: the home folder is
    // read-only as a whole because the workspace lives inside it, while its
    // Desktop, clear of the workspace, is written in full.
    if (
      effectiveFolderAccess({ access: "read-write", path: folderPath }) !==
      "read-write"
    ) {
      throw new Error(
        folderHoldsWorkspace(folderPath)
          ? `${MOUNT.folders}/${name} holds ${APP_NAME}'s own data, so it is read whole and never written whole. Add the folder inside that the work needs: ${MOUNT.folders}/${name}/<folder>.`
          : `"${spec}" is inside ${APP_NAME}'s own data, so nothing writes to it.`,
      );
    }
    return { path: folderPath };
  });
}

/**
 * How long a look inside a folder is given before it is taken to be the system
 * asking the user about the folder. A folder that is readable answers in
 * microseconds; one that is refused answers as fast. This only tells whether
 * the system is asking at all; how long to wait on the answer is
 * {@link ANSWER_WAIT_MS}.
 */
const LOOK_INSIDE_MS = 750;

/** The folder a spec names, as its mount path. */
function folderOfSpec(spec: string): string {
  const { name, subpath } = parseFolderSpec(spec);
  return [`${MOUNT.folders}/${name}`, subpath].filter(Boolean).join("/");
}

function refusal(error: unknown, spec: string) {
  const code =
    error instanceof Error && "code" in error ? String(error.code) : "";
  return readRefusalOf(error) === "system"
    ? `macOS has not let ${APP_NAME} into "${spec}". Call ${TOOL_NAMES.requestFolder} with folder "${folderOfSpec(spec)}": it opens the system's own panel at that folder, a pick there lets ${APP_NAME} in for good, and the same command then works.`
    : `"${spec}" cannot be read by the account ${APP_NAME} runs as (${code || "unknown error"}). Say so rather than trying again.`;
}

/**
 * A look inside the folder, which is what the operating system gates. On a Mac
 * the first look into Desktop, Documents, Downloads or a removable volume
 * raises the system's own ask, and taking it here puts that ask at the moment
 * the folder is added rather than at the first `ls` in it; a refusal already
 * given becomes a reason the conversation can pass on instead of an `EPERM`
 * to make sense of later.
 *
 * The ask blocks the look until the user answers, which can be never, so a
 * look that has not answered in time comes back as the answer still to come:
 * the caller waits on it a while (`awaitAnswers`) and refuses past that.
 */
async function requireReadable(
  folderPath: string,
  spec: string,
): Promise<undefined | { answer: Promise<string | undefined> }> {
  const answer = (async (): Promise<string | undefined> => {
    try {
      const dir = await fs.opendir(folderPath);
      try {
        await dir.read();
      } finally {
        await dir.close();
      }
      return;
    } catch (error) {
      return refusal(error, spec);
    }
  })();
  let timer: NodeJS.Timeout | undefined;
  const asking = new Promise<"asking">((resolve) => {
    timer = setTimeout(() => {
      resolve("asking");
    }, LOOK_INSIDE_MS);
  });
  const outcome = await Promise.race([
    answer.then((reason) => ({ reason })),
    asking,
  ]).finally(() => {
    clearTimeout(timer);
  });
  if (outcome === "asking") {
    return { answer };
  }
  if (outcome.reason) {
    throw new Error(outcome.reason);
  }
  return undefined;
}
