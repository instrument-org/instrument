import path from "node:path";

import { MOUNT } from "../../mount-points";
import { type TaskId } from "../../schemas/task-id";
import { FILES_FENCE, parseFilesBlock } from "../parse-files-block";
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
  ",",
  ".",
  ":",
  ";",
  ">",
  "]",
  "}",
]);

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

/** The folders a task reaches, as it reaches them. */
export async function mountsOf(taskId: TaskId): Promise<FolderMounts> {
  const state = await getTaskState(taskDir(taskId));
  return state.attachedFolders ?? {};
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
  let translated = "";
  let index = 0;
  for (const found of mountPathsIn(text, from, to)) {
    translated += text.slice(index, found.at);
    translated +=
      found.read?.mountPath ?? text.slice(found.at, found.subpathAt);
    index = found.read?.end ?? found.subpathAt;
  }
  return translated + text.slice(index);
}

/**
 * The mount paths in `text`, as the writing side wrote them, that name a
 * folder no mount of the reading side covers: the paths translateMountPaths
 * would leave as they were. Each is cut at the first place a path might end,
 * short of punctuation with more of the path after it (`notes.md`), which is
 * enough to say which folder was meant.
 */
export function unreachableMountPaths(
  text: string,
  from: FolderMounts,
  to: FolderMounts,
): string[] {
  const unreachable = new Set<string>();
  for (const found of mountPathsIn(text, from, to)) {
    if (found.read) {
      continue;
    }
    let end =
      text[found.subpathAt] === "/" ? found.subpathAt + 1 : found.subpathAt;
    while (end < text.length && !PATH_ENDS.has(text[end] ?? "")) {
      const next = text[end + 1];
      if (
        MAYBE_PATH_ENDS.has(text[end] ?? "") &&
        (next === undefined || /[\s)\]}>"'`]/u.test(next) || text[end] === " ")
      ) {
        break;
      }
      end++;
    }
    unreachable.add(text.slice(found.at, end).replace(/\/$/u, ""));
  }
  return [...unreachable];
}

/**
 * Every mount path in the text that starts with one of the writing side's
 * mounts, with how it reads on the reading side, or no reading where no mount
 * there covers it.
 */
function* mountPathsIn(
  text: string,
  from: FolderMounts,
  to: FolderMounts,
): Generator<{
  at: number;
  read: ReturnType<typeof readSubpath>;
  subpathAt: number;
}> {
  if (!text.includes(PREFIX)) {
    return;
  }
  // Longest first, so `Home-Downloads` is not read as `Home` with something
  // called `-Downloads` inside it.
  const sources = Object.values(from).toSorted(
    (a, b) => b.mountName.length - a.mountName.length,
  );
  let index = 0;
  for (;;) {
    const at = text.indexOf(PREFIX, index);
    if (at === -1) {
      return;
    }
    const nameAt = at + PREFIX.length;
    const source = sources.find((folder) =>
      startsWithMountName(text, nameAt, folder.mountName),
    );
    if (!source) {
      index = nameAt;
      continue;
    }
    const subpathAt = nameAt + source.mountName.length;
    const read = readSubpath(text, subpathAt, source, to);
    yield { at, read, subpathAt };
    index = read?.end ?? subpathAt;
  }
}

/**
 * The task's own root wherever a path starts with it: at the start of the
 * text, after whitespace, or after an opening quote, bracket, or backtick.
 * Not the same segment inside another path or an address, where the word
 * belongs to that path: `/mnt/Home/Projects/task/notes.md` names a folder of
 * the user's, and `https://example.com/task/42` names a page. The mount's
 * name has nothing a pattern reads specially.
 */
const TASK_ROOT = new RegExp(String.raw`(?<![\w./-])${MOUNT.task}/`, "gu");

/**
 * The same text with the task's own folder rewritten to the name the
 * conversation that started it reaches that folder by. A task writes
 * `work/report.html` or `/task/work/report.html` for a file the conversation
 * reaches as `/tasks/<id>/work/report.html`. The absolute form is rewritten
 * wherever a path starts with it; the relative one only in a files fence,
 * where a line that is not an absolute path can be nothing but a task path.
 * The fence comes out as the parser reads it, one path per line with the
 * bullets and backticks an agent adds taken off, so what the conversation
 * is handed is a path it can open.
 */
export function translateTaskFolderPaths(text: string, taskId: TaskId): string {
  const root = `${MOUNT.tasks}/${taskId}`;
  return text
    .replaceAll(TASK_ROOT, `${root}/`)
    .replaceAll(FILES_FENCE, (fence: string, body: string) => {
      const lines = parseFilesBlock(body).map((filePath) =>
        filePath.startsWith("/") ? filePath : `${root}/${filePath}`,
      );
      return fence.replace(body, () => `\n${lines.join("\n")}\n`);
    });
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
