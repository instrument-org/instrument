import { APP_NAME } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";

import { TASK_FOLDER_NAMES } from "../../constants";
import { MOUNT } from "../../mount-points";
import { type FileUpload } from "../../schemas/file-upload";
import { type FolderAttachment } from "../../schemas/folder-attachment";
import { getMimeType } from "../get-mime-type";
import { resolveExistingFilePath } from "../resolve-agent-path";
import {
  effectiveFolderAccess,
  folderHoldsWorkspace,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";

/**
 * `--flag value` and `--flag=value` pairs, plus everything else in order. Each
 * flag in `repeatable` collects every value it is given; the others keep the
 * last. Values are whatever the shell already split them into, so a quoted
 * prompt arrives whole.
 */
export function parseFlags(
  args: string[],
  {
    boolean = [],
    flags,
    repeatable,
  }: { boolean?: string[]; flags: string[]; repeatable: string[] },
) {
  const values = new Map<string, string[]>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? "";
    const inline = /^--([a-z-]+)=(.*)$/.exec(argument);
    const name = inline?.[1] ?? argument.replace(/^--/, "");
    // A switch takes no value: present or absent, and never the next token.
    if (argument.startsWith("--") && !inline && boolean.includes(name)) {
      values.set(name, []);
      continue;
    }
    if (argument.startsWith("--") && flags.includes(name)) {
      const value = inline ? inline[2] : args[++index];
      if (value === undefined) {
        throw new Error(`--${name} needs a value.`);
      }
      const list = values.get(name) ?? [];
      values.set(name, repeatable.includes(name) ? [...list, value] : [value]);
      continue;
    }
    positional.push(argument);
  }
  return { positional, values };
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
): Promise<void> {
  for (const [index, folder] of folders.entries()) {
    const spec = specs[index] ?? folder.path;
    let stat;
    try {
      stat = await fs.stat(folder.path);
    } catch {
      throw new Error(
        `no folder at "${spec}": nothing is on disk at ${folder.path}. A folder renamed or moved since it was named is under its new name; \`ls\` its parent to see what is there. A path with a space in it needs quotes: --folder '${MOUNT.attachedFolders}/<mount>/a folder:rw'.`,
      );
    }
    if (!stat.isDirectory()) {
      throw new Error(
        `"${spec}" is a file, not a folder. A task is handed the folder, and finds the file inside it.`,
      );
    }
    await requireReadable(folder.path, spec);
  }
}

/**
 * The files a task is handed, from the `--file` specs on `task new` and
 * `task send`: each a path the conversation can read, resolved through its own
 * view of the filesystem to the file on disk. The message the task gets copies
 * each into the task's `attachments/`, the way a file the user attaches to a
 * message reaches a task, so a file is handed over without the folder around
 * it: no grant widens, and the original stays where it is.
 *
 * Relative specs count from the shell's working directory, as `cat` would read
 * them, rather than from the task root the file tools assume.
 */
export async function resolveFileUploads(
  specs: string[],
  { cwd, layout }: { cwd: string; layout: WorkspaceFsLayout },
): Promise<FileUpload.Type[]> {
  return Promise.all(
    specs.map(async (spec) => {
      const inputPath = path.posix.isAbsolute(spec)
        ? spec
        : path.posix.join(cwd, spec);
      const resolved = resolveExistingFilePath({ inputPath, layout });
      if (resolved.isErr()) {
        throw new Error(`no file at "${spec}": ${resolved.error.message}`);
      }
      const hostPath = resolved.value.absolutePath;
      let stat;
      try {
        stat = await fs.stat(hostPath);
      } catch {
        throw new Error(
          `no file at "${spec}": nothing is on disk there. \`ls\` its folder to see what is there; a path with a space in it needs quotes.`,
        );
      }
      if (stat.isDirectory()) {
        throw new Error(
          `"${spec}" is a folder. --file hands a task one file; a folder goes with --folder.`,
        );
      }
      return {
        filename: path.basename(hostPath),
        mimeType: getMimeType(hostPath),
        path: hostPath,
        size: stat.size,
      };
    }),
  );
}

/**
 * A path in the conversation's own folder as a brief writes one: from the
 * root, or bare from the folder the shell is in.
 */
const OWN_FILE_IN_BRIEF = new RegExp(
  String.raw`(?<![\w/.-])((?:${MOUNT.task}|${TASK_FOLDER_NAMES.attachments})/[^\s'"\`()[\]]+)`,
  "g",
);

/**
 * A brief that names a file in this conversation's own folder without handing
 * it over is refused, with the flag to add: no task can see that folder, so
 * the task would fail at its first read and wake the conversation about it,
 * which is a turn spent on what this catches. A file handed over lands at the
 * same path in the task's own folder, so the brief's name for it stays right.
 *
 * `/task` in a brief is also the task's own folder, so a path with no file
 * behind it is an output the brief asks the task to make, and passes.
 */
export async function requireFilesNamedInBrief(
  prompt: string,
  specs: string[],
  { cwd, layout }: { cwd: string; layout: WorkspaceFsLayout },
): Promise<void> {
  const handed = new Set(specs.map((spec) => ownPath(spec, cwd)));
  const named = [
    ...new Set(
      [...prompt.matchAll(OWN_FILE_IN_BRIEF)].map((match) =>
        ownPath((match[1] ?? "").replace(/[.,;:]+$/, ""), cwd),
      ),
    ),
  ].filter((path) => !handed.has(path));
  const missing = (
    await Promise.all(
      named.map(async (inputPath) => {
        const resolved = resolveExistingFilePath({ inputPath, layout });
        if (resolved.isErr()) {
          return;
        }
        const stat = await fs
          .stat(resolved.value.absolutePath)
          .catch(() => undefined);
        return stat?.isFile() ? inputPath : undefined;
      }),
    )
  ).filter((path) => path !== undefined);
  if (missing.length > 0) {
    throw new Error(
      `the brief names ${missing.map((named) => `"${named}"`).join(", ")} in this conversation's own folder, which no task can see. Add ${missing.map((named) => `--file ${named}`).join(" ")}: a copy lands in the task's own ${TASK_FOLDER_NAMES.attachments}/ under the same name.`,
    );
  }
}

/**
 * The folders a task is handed, from the `--folder` specs on `task new` and
 * the folders the conversation has: each a host path inside a mount, with the
 * conversation's access unless the spec narrows it.
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
        `"${spec}" leaves ${MOUNT.attachedFolders}/${name}. A task can be handed a folder inside a mount, not one outside it.`,
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
          ? `${MOUNT.attachedFolders}/${name} holds ${APP_NAME}'s own data, so a task reads it whole and never writes it whole. Hand it the folder inside that the work needs: --folder ${MOUNT.attachedFolders}/${name}/<folder>:rw.`
          : `${MOUNT.attachedFolders}/${name} is read-only in this conversation, so a task cannot write to it. Ask the user to attach it with write access.`,
      );
    }
    // The task gets what the conversation has unless the brief narrows it.
    return {
      access: access ?? granted,
      path: folderPath,
      source: "user" as const,
    };
  });
}

function ownPath(spec: string, cwd: string): string {
  return path.posix.normalize(
    path.posix.isAbsolute(spec) ? spec : path.posix.join(cwd, spec),
  );
}

/**
 * How long a look inside a folder is given before it is taken to be the system
 * asking the user about the folder. A folder that is readable answers in
 * microseconds; one that is refused answers as fast.
 */
const LOOK_INSIDE_MS = 750;

/**
 * A delay the way the conversation writes one: `30s`, `5m`, `1h`, `90 sec`,
 * `2 hours`, or bare seconds. Undefined for anything else, and for zero.
 */
export function parseDelay(raw: string): number | undefined {
  const match =
    /^(\d+(?:\.\d+)?)\s*([smh]|sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours)?$/i.exec(
      raw.trim(),
    );
  if (!match?.[1]) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const perUnit = unit.startsWith("h")
    ? 3_600_000
    : unit.startsWith("m")
      ? 60_000
      : 1000;
  const delay = amount * perUnit;
  return delay > 0 ? Math.round(delay) : undefined;
}

/**
 * A look inside the folder, which is what the operating system gates where a
 * stat is not. On a Mac the first look into Desktop, Documents, Downloads or a
 * removable volume raises the system's own ask, and taking it here puts that
 * ask at the moment the user pointed at the folder rather than at the task's
 * first `ls`; a refusal already given becomes a reason the conversation can
 * pass on instead of an `EPERM` a task has to make sense of.
 *
 * The ask blocks the look until the user answers, and the command must not
 * wait on that: it would outlive the call's yield and come back as a
 * background job. So a look that has not answered in time is let go, and the
 * task starts: its first read waits on the same answer, and a refusal given
 * then reaches it there.
 */
async function requireReadable(folderPath: string, spec: string) {
  const look = (async () => {
    const dir = await fs.opendir(folderPath);
    try {
      await dir.read();
    } finally {
      await dir.close();
    }
  })();
  let timer: NodeJS.Timeout | undefined;
  const asking = new Promise<"asking">((resolve) => {
    timer = setTimeout(() => {
      resolve("asking");
    }, LOOK_INSIDE_MS);
  });
  const outcome = await Promise.race([
    look.then(
      () => "readable" as const,
      (error: unknown) => error,
    ),
    asking,
  ]).finally(() => {
    clearTimeout(timer);
  });
  if (outcome === "readable" || outcome === "asking") {
    return;
  }
  const code =
    outcome instanceof Error && "code" in outcome ? String(outcome.code) : "";
  throw new Error(
    process.platform === "darwin" && code === "EPERM"
      ? `macOS did not let ${APP_NAME} into "${spec}": the user declined its ask. They can allow ${APP_NAME} under System Settings, Privacy & Security, Files and Folders, after which the same command works.`
      : `"${spec}" cannot be read by the account ${APP_NAME} runs as (${code || "unknown error"}). Say so rather than trying again.`,
  );
}
