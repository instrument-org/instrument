import path from "node:path";

import { MOUNT } from "../../mount-points";
import { type FolderAttachment } from "../../schemas/folder-attachment";
import { effectiveFolderAccess } from "../workspace-fs-layout";

/**
 * `--flag value` and `--flag=value` pairs, plus everything else in order. Each
 * flag in `repeatable` collects every value it is given; the others keep the
 * last. Values are whatever the shell already split them into, so a quoted
 * prompt arrives whole.
 */
export function parseFlags(
  args: string[],
  { flags, repeatable }: { flags: string[]; repeatable: string[] },
) {
  const values = new Map<string, string[]>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? "";
    const inline = /^--([a-z-]+)=(.*)$/.exec(argument);
    const name = inline?.[1] ?? argument.replace(/^--/, "");
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
    const granted = effectiveFolderAccess(folder);
    if (access === "read-write" && granted !== "read-write") {
      throw new Error(
        `${MOUNT.attachedFolders}/${name} is read-only in this conversation, so a task cannot write to it. Ask the user to attach it with write access.`,
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
    // The task gets what the conversation has unless the brief narrows it.
    return {
      access: access ?? granted,
      path: folderPath,
      source: "user" as const,
    };
  });
}
