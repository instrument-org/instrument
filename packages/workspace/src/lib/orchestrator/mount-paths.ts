import path from "node:path";

import { MOUNT } from "../../mount-points";
import { type TaskId } from "../../schemas/task-id";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";

/** The folders a task reaches, by the name each is mounted under. */
export type FolderMounts = Record<string, { mountName: string; path: string }>;

const PREFIX = `${MOUNT.attachedFolders}/`;

/**
 * Where a mount path certainly ends. Short, because a folder's name is its
 * name on disk and may hold nearly anything a sentence can: the reading is
 * settled by which one names a folder rather than by where the writing stops.
 */
const PATH_ENDS = new Set(["\n", "\r", '"', "'", "`"]);

/**
 * Where a mount path might end. A sentence that finishes on a path, a path in
 * parentheses, the `:rw` on a `--folder` spec, and the space before the next
 * word all end one, and every one of them can equally sit inside a folder's
 * name.
 */
const MAYBE_PATH_ENDS = new Set([
  " ",
  "\t",
  ")",
  "]",
  "}",
  ",",
  ";",
  ":",
  ".",
  ">",
]);

/** The folders a task reaches, as it reaches them. */
export async function mountsOf(taskId: TaskId): Promise<FolderMounts> {
  const state = await getTaskState(taskDir(taskId));
  return state.attachedFolders ?? {};
}

/**
 * The path a folder on disk is reached by in `mounts`, through the deepest
 * mount that covers it, or undefined where none does.
 */
export function mountPathOf(
  hostPath: string,
  mounts: FolderMounts,
): string | undefined {
  return deepestMount(path.resolve(hostPath), mounts)?.mountPath;
}

/**
 * The mount that covers a folder most closely, of those a task has. Two mounts
 * can both cover it -- the home folder and something inside it -- and the
 * closer one is the one that says most about which folder is meant.
 */
function deepestMount(
  hostPath: string,
  mounts: FolderMounts,
): undefined | { depth: number; mountPath: string } {
  let deepest: undefined | { mountName: string; root: string };
  for (const folder of Object.values(mounts)) {
    const root = path.resolve(folder.path);
    const covers =
      hostPath === root || hostPath.startsWith(`${root}${path.sep}`);
    if (
      covers &&
      (deepest === undefined || root.length > deepest.root.length)
    ) {
      deepest = { mountName: folder.mountName, root };
    }
  }
  if (!deepest) {
    return undefined;
  }
  const rest = hostPath.slice(deepest.root.length).split(path.sep).join("/");
  return {
    depth: deepest.root.length,
    mountPath: `${PREFIX}${deepest.mountName}${rest}`,
  };
}

/**
 * The same text with every mount path in it rewritten from the mounts of the
 * task that wrote it to the mounts of the task that reads it.
 *
 * Mount names are assigned per task (see assign-mount-names.ts), so the two
 * sides need not agree on them and, where two folders share a name, need not
 * even disagree visibly. A conversation holding the whole home folder mounts
 * Downloads inside it and names it for the home folder; the task handed
 * Downloads alone mounts it at the top and names it for itself. And a
 * conversation that hands over a folder of the user's called Instrument gives
 * that task a mount of that name which is not the workspace folder its own
 * mount of that name is. Going through the folder on disk settles both: a name
 * is only ever read against the mounts of the side that wrote it.
 *
 * A path no mount on the reading side covers is left exactly as it was, so a
 * task told about a folder it was not handed fails on the folder it was told
 * about rather than on a neighboring one.
 */
export function translateMountPaths(
  text: string,
  from: FolderMounts,
  to: FolderMounts,
): string {
  if (!text.includes(PREFIX)) {
    return text;
  }
  // Longest first, so `Home-Downloads` is not read as `Home` with something
  // called `-Downloads` inside it.
  const sources = Object.values(from).toSorted(
    (a, b) => b.mountName.length - a.mountName.length,
  );
  let translated = "";
  let index = 0;
  for (;;) {
    const at = text.indexOf(PREFIX, index);
    if (at === -1) {
      return translated + text.slice(index);
    }
    translated += text.slice(index, at);
    const nameAt = at + PREFIX.length;
    const source = sources.find((folder) =>
      startsWithMountName(text, nameAt, folder.mountName),
    );
    if (!source) {
      translated += PREFIX;
      index = nameAt;
      continue;
    }
    const subpathAt = nameAt + source.mountName.length;
    const read = readSubpath(text, subpathAt, source, to);
    translated += read?.mountPath ?? text.slice(at, subpathAt);
    index = read?.end ?? subpathAt;
  }
}

/**
 * Whether a mount's name is the name at this point in the text, rather than
 * the start of a longer one: `Home` is not the mount in `/mnt/Home-Downloads`.
 */
function startsWithMountName(
  text: string,
  at: number,
  mountName: string,
): boolean {
  if (!text.startsWith(mountName, at)) {
    return false;
  }
  const after = text[at + mountName.length];
  return (
    after === undefined ||
    after === "/" ||
    PATH_ENDS.has(after) ||
    MAYBE_PATH_ENDS.has(after)
  );
}

/**
 * How far the path runs past its mount name, and what that folder is called on
 * the reading side.
 *
 * Every reading is tried, from the mount on its own to everything up to the
 * next quote or line break, and the one that lands in the closest mount wins,
 * the shortest of those where several tie. Closest rather than longest,
 * because a reading is only as good as the folder it finds: `Downloads` inside
 * a brief that goes on to say something else about the file is a reading that
 * lands in the home folder along with the rest of the sentence, and
 * `Downloads` on its own is one that lands in Downloads. Shortest among equals,
 * because whatever the reading leaves behind is carried over untouched, and a
 * path that reads the same to both sides needs no more than its folder
 * translated.
 *
 * Undefined when nothing resolves, which leaves the path exactly as it was.
 */
function readSubpath(
  text: string,
  at: number,
  source: { mountName: string; path: string },
  to: FolderMounts,
): undefined | { end: number; mountPath: string } {
  let ends = at;
  while (ends < text.length && !PATH_ENDS.has(text[ends] ?? "")) {
    ends++;
  }
  const root = path.resolve(source.path);
  let best: undefined | { depth: number; end: number; mountPath: string };
  for (let end = at; end <= ends; end++) {
    if (end !== ends && end !== at && !MAYBE_PATH_ENDS.has(text[end] ?? "")) {
      continue;
    }
    const hostPath = path.join(root, text.slice(at, end));
    // A `..` that climbs out of the mount names a folder the writing side was
    // not given, so the path is left as it was rather than pointed at a folder
    // the reading side does have.
    if (hostPath !== root && !hostPath.startsWith(`${root}${path.sep}`)) {
      return undefined;
    }
    const found = deepestMount(hostPath, to);
    if (found && (best === undefined || found.depth > best.depth)) {
      best = { depth: found.depth, end, mountPath: found.mountPath };
    }
  }
  return best;
}
