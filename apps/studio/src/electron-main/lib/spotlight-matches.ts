import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { PACKAGE_EXTENSIONS, type WalkedEntry } from "./folder-walk";

/** The most matches one search takes from Spotlight. */
const MAX_MATCHES = 200;

/** How long Spotlight has to answer before the search keeps what it has. */
const SPOTLIGHT_MS = 3000;

/** Stepped-over folders that hold the programs' own files, never filled in. */
const PROGRAM_FOLDERS: ReadonlySet<string> = new Set([
  "Containers",
  "Group Containers",
  // oxlint-disable-next-line studio/no-os-words -- a folder only macOS has
  "Library",
]);

/**
 * Of the paths Spotlight matched, the ones in a folder a walk from `root`
 * stepped over (`skips` inside `root`), leaving out hidden names,
 * `node_modules`, what is inside a package, and the program folders. Of
 * iCloud's folders only iCloud Drive's own is kept: the other apps' are
 * their data.
 */
export function steppedOverMatches(
  paths: readonly string[],
  { root, skips }: { root: string; skips: ReadonlySet<string> },
): string[] {
  const top = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const folders = [...skips]
    .filter(
      (skip) =>
        skip.startsWith(top) && !PROGRAM_FOLDERS.has(path.basename(skip)),
    )
    .map((skip) =>
      path.basename(skip) === "Mobile Documents"
        ? path.join(skip, "com~apple~CloudDocs")
        : skip,
    );
  return paths.filter((at) => {
    const folder = folders.find((skip) => at.startsWith(`${skip}${path.sep}`));
    if (folder === undefined) {
      return false;
    }
    const names = at.slice(folder.length + 1).split(path.sep);
    return names.every(
      (name, index) =>
        !name.startsWith(".") &&
        (index === names.length - 1 ||
          (name !== "node_modules" &&
            !PACKAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))),
    );
  });
}

/**
 * What Spotlight finds by name in the folders a walk from `root` stepped
 * over, as the walk lists them. The query names no folder: one that named a
 * folder macOS guards would put up its prompt, while one that names none is
 * answered only from the folders this app may read.
 */
export async function spotlightMatches(
  root: string,
  word: string,
  skips: ReadonlySet<string>,
): Promise<WalkedEntry[]> {
  const paths = await new Promise<string[]>((resolve) => {
    const kept: string[] = [];
    let rest = "";
    const child = spawn("/usr/bin/mdfind", ["-name", word]);
    const done = () => {
      clearTimeout(timer);
      child.kill();
      resolve(kept);
    };
    const timer = setTimeout(done, SPOTLIGHT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const lines = `${rest}${chunk}`.split("\n");
      rest = lines.pop() ?? "";
      kept.push(...steppedOverMatches(lines, { root, skips }));
      if (kept.length >= MAX_MATCHES) {
        kept.length = MAX_MATCHES;
        done();
      }
    });
    child.on("error", done);
    child.on("close", done);
  });
  const entries = await Promise.all(
    paths.map(async (at): Promise<WalkedEntry | undefined> => {
      const stats = await fs.lstat(at).catch(() => null);
      if (!stats || !(stats.isFile() || stats.isDirectory())) {
        return undefined;
      }
      const isPackage =
        stats.isDirectory() &&
        PACKAGE_EXTENSIONS.has(path.extname(at).toLowerCase());
      return {
        createdAt: stats.birthtimeMs,
        folder: path.relative(root, path.dirname(at)).split(path.sep).join("/"),
        isFolder: stats.isDirectory() && !isPackage,
        modifiedAt: stats.mtimeMs,
        name: path.basename(at),
        ...(isPackage ? { package: true as const } : {}),
        path: at,
        ...(stats.isFile() ? { size: stats.size } : {}),
      };
    }),
  );
  return entries.filter((entry) => entry !== undefined);
}
