import path from "node:path";

import { MOUNT } from "../../mount-points";
import { type TaskId } from "../../schemas/task-id";
import { FILES_FENCE, parseFilesBlock } from "../parse-files-block";

/** The folders a chat or a task reaches, by the name each is mounted under. */
export type FolderMounts = Record<string, { mountName: string; path: string }>;

/**
 * One folder a task holds, at the path the task reaches it by and the path
 * its chat does, or no chat path where the chat no longer reaches it.
 */
export interface MountAlias {
  chatPath: string | undefined;
  taskPath: string;
}

const PREFIX = `${MOUNT.attachedFolders}/`;

/**
 * The path a folder on disk is reached by in `mounts`, through the deepest
 * mount that covers it, or undefined where none does.
 */
export function mountPathOf(
  hostPath: string,
  mounts: FolderMounts,
): string | undefined {
  const wanted = path.resolve(hostPath);
  let deepest: undefined | { mountName: string; root: string };
  for (const folder of Object.values(mounts)) {
    const root = path.resolve(folder.path);
    const covers = wanted === root || wanted.startsWith(`${root}${path.sep}`);
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
  const rest = wanted.slice(deepest.root.length).split(path.sep).join("/");
  return `${PREFIX}${deepest.mountName}${rest}`;
}

/**
 * The path a chat reaches one of its task's folders by.
 *
 * A task the chat granted a folder mounts it under the chat's own path for it
 * (`Home/Downloads`), so its name read against the chat's mounts is that path.
 * A task granted folders before names were shared holds names of its own
 * (`Downloads`), and so does one whose chat has since renamed a mount; for
 * those the chat's path is wherever the chat reaches the folder on disk.
 */
function chatPathOf(
  folder: { mountName: string; path: string },
  chatFolders: FolderMounts,
): string | undefined {
  const [name = "", ...rest] = folder.mountName.split("/");
  const chatMount = Object.values(chatFolders).find(
    (candidate) => candidate.mountName === name,
  );
  if (
    chatMount &&
    path.resolve(chatMount.path, ...rest) === path.resolve(folder.path)
  ) {
    return `${PREFIX}${folder.mountName}`;
  }
  return mountPathOf(folder.path, chatFolders);
}

/** Every folder a task holds, at its path and at its chat's. */
export function mountAliases(
  chatFolders: FolderMounts,
  taskFolders: FolderMounts,
): MountAlias[] {
  return Object.values(taskFolders).map((folder) => ({
    chatPath: chatPathOf(folder, chatFolders),
    taskPath: `${PREFIX}${folder.mountName}`,
  }));
}

/** Text the chat wrote, in the paths its task reaches the same folders by. */
export function toTaskPaths(text: string, aliases: MountAlias[]): string {
  return swapPrefixes(
    text,
    aliases.flatMap(({ chatPath, taskPath }) =>
      chatPath === undefined ? [] : [{ from: chatPath, to: taskPath }],
    ),
  );
}

/** Text a task wrote, in the paths its chat reaches the same folders by. */
export function toChatPaths(text: string, aliases: MountAlias[]): string {
  return swapPrefixes(
    text,
    aliases.flatMap(({ chatPath, taskPath }) =>
      chatPath === undefined ? [] : [{ from: taskPath, to: chatPath }],
    ),
  );
}

/**
 * The paths in `text` under one of the chat's mounts that no path in
 * `handed` covers: what a task handed only those would not find. Each is cut
 * where the writing around it most likely resumes, which is enough to say
 * which folder was meant.
 *
 * A path is only ever compared against a whole mount path, so nothing here
 * decides where a path ends: `/mnt/Home/Downloads` covers
 * `/mnt/Home/Downloads/notes.md` and `/mnt/Home/Downloads.` at the end of a
 * sentence, and not `/mnt/Home/Downloads-old`.
 */
export function mountPathsOutside(
  text: string,
  chatFolders: FolderMounts,
  handed: string[],
): string[] {
  const chatPaths = Object.values(chatFolders).map(
    (folder) => `${PREFIX}${folder.mountName}`,
  );
  const outside = new Set<string>();
  for (const at of prefixOccurrences(text)) {
    if (!chatPaths.some((chatPath) => startsWithPath(text, at, chatPath))) {
      continue;
    }
    if (handed.some((handedPath) => startsWithPath(text, at, handedPath))) {
      continue;
    }
    outside.add(pathAt(text, at));
  }
  return [...outside];
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

/** Where a path in prose most likely ends: before a space, a quote, or a bracket, and before punctuation closing a sentence. */
function pathAt(text: string, at: number): string {
  const rest = text.slice(at);
  const end = rest.search(/[\s"'`<>()[\]{}]/u);
  return (end === -1 ? rest : rest.slice(0, end))
    .replace(/[.,;:!?]+$/u, "")
    .replace(/\/$/u, "");
}

/** Every index in `text` where a mount path begins. */
function* prefixOccurrences(text: string): Generator<number> {
  for (
    let at = text.indexOf(PREFIX);
    at !== -1;
    at = text.indexOf(PREFIX, at + PREFIX.length)
  ) {
    yield at;
  }
}

/**
 * Whether the text at `at` is `mountPath` or a path under it, rather than the
 * start of a longer name: `/mnt/Home` is not the mount in
 * `/mnt/Home-Downloads` or `/mnt/Home.old`, and is in `/mnt/Home.` at the end
 * of a sentence and in `/mnt/Home:rw`.
 */
function startsWithPath(text: string, at: number, mountPath: string): boolean {
  if (!text.startsWith(mountPath, at)) {
    return false;
  }
  const after = text.slice(at + mountPath.length);
  return !/^(?:[\p{L}\p{N}_-]|\.[\p{L}\p{N}_-])/u.test(after);
}

/**
 * The text with each `from` mount path swapped for its `to`, the longest
 * `from` first so a mount inside another is swapped as itself. A pair that
 * swaps a path for itself is no swap, so a task granted folders under its
 * chat's names leaves text as it was.
 */
function swapPrefixes(
  text: string,
  pairs: { from: string; to: string }[],
): string {
  const swaps = pairs
    .filter(({ from, to }) => from !== to)
    .toSorted((a, b) => b.from.length - a.from.length);
  if (swaps.length === 0) {
    return text;
  }
  let swapped = "";
  let index = 0;
  for (const at of prefixOccurrences(text)) {
    if (at < index) {
      continue;
    }
    const swap = swaps.find(({ from }) => startsWithPath(text, at, from));
    if (!swap) {
      continue;
    }
    swapped += text.slice(index, at) + swap.to;
    index = at + swap.from.length;
  }
  return swapped + text.slice(index);
}
