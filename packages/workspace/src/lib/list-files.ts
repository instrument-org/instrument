import fs from "node:fs/promises";

import { type AbsolutePath } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { pathExists } from "./path-exists";

interface ListFilesResult {
  files: string[];
  truncated: boolean;
}

export async function listFiles(
  rootDir: AbsolutePath,
  options: {
    exclude?: string[];
    hidden?: boolean;
    limit?: number;
    searchPath?: string;
    signal?: AbortSignal;
  } = {},
): Promise<ListFilesResult> {
  const targetPath = options.searchPath
    ? absolutePathJoin(rootDir, options.searchPath)
    : rootDir;

  const exists = await pathExists(targetPath);
  if (!exists) {
    return { files: [], truncated: false };
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });

  const filtered = entries
    .filter((entry) => options.hidden || !entry.name.startsWith("."))
    .filter((entry) => !options.exclude?.includes(entry.name))
    // A trailing slash is the only signal a caller has that an entry is a
    // directory, since the listing is otherwise bare names.
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort((a, b) => a.localeCompare(b));

  const limit = options.limit;
  if (limit !== undefined && filtered.length > limit) {
    return { files: filtered.slice(0, limit), truncated: true };
  }

  return { files: filtered, truncated: false };
}
