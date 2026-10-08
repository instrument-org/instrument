import { APP_NAME } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { noop } from "radashi";

import { MOUNT, WORKSPACE_SKILLS_MOUNT } from "../../mount-points";
import { type FolderAttachment } from "../../schemas/folder-attachment";
import { TOOL_NAMES } from "../../tools/name";
import { readRefusalOf } from "../read-refusal";
import {
  effectiveFolderAccess,
  folderHoldsWorkspace,
} from "../workspace-fs-layout";

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
 * `--folder Home/Downloads:rw`: the mount, the folder inside it when the task
 * gets less than the whole mount, and the access asked for.
 */
export function parseFolderSpec(spec: string): {
  access?: FolderAttachment.Access;
  name: string;
  subpath: string;
} {
  const match = /^(.*?)(?::(rw|ro|read-write|read-only))?$/.exec(spec);
  const raw = match?.[1] ?? spec;
  const suffix = match?.[2];
  const prefix = `${MOUNT.attachedFolders}/`;
  const inside = (raw.startsWith(prefix) ? raw.slice(prefix.length) : raw)
    .replace(/\/+$/, "")
    .trim();
  const [name = "", ...rest] = inside.split("/");
  const access =
    suffix === "rw" || suffix === "read-write"
      ? ("read-write" as const)
      : suffix === undefined
        ? undefined
        : ("read-only" as const);
  return { access, name, subpath: rest.filter(Boolean).join("/") };
}

/**
 * Every folder a task is handed has to be on disk. The path the note named a
 * moment ago can be gone by the time the command runs (a folder renamed in
 * the Finder, a path with a space in it that lost its tail to the shell), and
 * a task started on it fails at its first `ls` and wakes the conversation
 * about it; refusing here hands the conversation the fix instead. The specs
 * are the folders' own, in the same order, so the refusal names what was
 * typed.
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
        `no folder at "${spec}": nothing is on disk at ${folder.path}. A folder renamed or moved since it was named is under its new name; \`ls\` its parent to see what is there. A path with a space in it needs quotes: '${MOUNT.attachedFolders}/<mount>/a folder'.`,
      );
    }
    if (!stat.isDirectory()) {
      throw new Error(
        `"${spec}" is a file, not a folder. A task is handed the folder, and finds the file inside it.`,
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
 * How long `task new` waits on the user's answer to the system's ask before
 * making the task and holding it. Most people answer a dialog they were just
 * told about within this, and an answer inside it is reported as what it is: a
 * task started, or a refusal with nothing created.
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
  // A refusal that comes after the wait is the held task's to report, not
  // this command's.
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
 * conversation has: each a host path inside a mount, with the conversation's
 * access unless the spec narrows it, and the name it mounts under, which is
 * the conversation's own path for it (`Home/Downloads` for
 * `/mnt/Home/Downloads`).
 */
export function resolveFolders(
  specs: string[],
  attached: Record<string, FolderAttachment.Type>,
) {
  const byMount = new Map(
    Object.values(attached).map((folder) => [folder.mountName, folder]),
  );
  const available =
    [...byMount.keys()]
      .map((name) => `${MOUNT.attachedFolders}/${name}`)
      .join(", ") || "none";
  return specs.map((spec) => {
    const { access, name, subpath } = parseFolderSpec(spec);
    const folder = byMount.get(name);
    if (!folder && spec.startsWith(`${MOUNT.skills}/`)) {
      throw new Error(
        `"${spec}" needs no grant: skills are written to ${WORKSPACE_SKILLS_MOUNT}/<name>/ as they are.`,
      );
    }
    if (!folder && name === "") {
      throw new Error(
        `"${spec}" is not one of this conversation's folders: a folder is ${MOUNT.attachedFolders}/<mount>[/<folder>]. Yours: ${available}.`,
      );
    }
    if (!folder) {
      throw new Error(
        `no folder "${name}" in this conversation. Yours: ${available}; a folder inside one is written ${MOUNT.attachedFolders}/<mount>/<folder>. Ask for one outside them with request_folder.`,
      );
    }
    // A folder inside the mount and never one outside it: `..` in the
    // subpath would hand a task a folder the user never granted.
    const root = path.resolve(folder.path);
    const folderPath = subpath ? path.resolve(root, subpath) : root;
    if (folderPath !== root && !folderPath.startsWith(`${root}${path.sep}`)) {
      throw new Error(
        `"${spec}" leaves ${MOUNT.attachedFolders}/${name}. A folder inside a mount can be granted, not one outside it.`,
      );
    }
    // The grant is judged for the folder handed, not for the mount: the home
    // folder is read-only as a whole because the workspace lives inside it,
    // while its Desktop, clear of the workspace, carries the grant in full.
    const granted = effectiveFolderAccess({
      access: folder.access,
      path: folderPath,
    });
    if (access === "read-write" && granted !== "read-write") {
      throw new Error(
        folder.access === "read-write" && folderHoldsWorkspace(folderPath)
          ? `${MOUNT.attachedFolders}/${name} holds ${APP_NAME}'s own data, so it is read whole and never written whole. Add the folder inside that the work needs: ${MOUNT.attachedFolders}/${name}/<folder>.`
          : `${MOUNT.attachedFolders}/${name} is read-only in this conversation, so nothing writes to it. Ask the user to attach it with write access.`,
      );
    }
    const inside = path.relative(root, folderPath).split(path.sep);
    // What the conversation has, unless the spec narrows it.
    return {
      access: access ?? granted,
      mountName: [name, ...inside.filter(Boolean)].join("/"),
      path: folderPath,
      source: "user" as const,
    };
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

/** The folder a spec names, without the access it asks for. */
function folderOfSpec(spec: string): string {
  const { name, subpath } = parseFolderSpec(spec);
  return [`${MOUNT.attachedFolders}/${name}`, subpath]
    .filter(Boolean)
    .join("/");
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
 * the user pointed at the folder rather than at the task's first `ls`; a
 * refusal already given becomes a reason the conversation can pass on instead
 * of an `EPERM` a task has to make sense of.
 *
 * The ask blocks the look until the user answers, which can be never, so a
 * look that has not answered in time comes back as the answer still to come:
 * the caller waits on it a while (`awaitAnswers`) and holds the task on it
 * past that. Only a listing waits on the ask: a file written or read by its
 * path goes through while it is up, so a task started before the answer
 * writes into the folder whatever the user then says.
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
