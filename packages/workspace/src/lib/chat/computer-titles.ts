import fs from "node:fs/promises";
import path from "node:path";

import { pageTitle, plainText } from "../page-title";

/**
 * The titles pages on this computer give themselves, for a folder listed by
 * them rather than by their names: a page's title (`pageTitle`),
 * a Markdown file's front matter `title:` (or its first heading).
 *
 * Each file is read from the top in chunks until its title or first heading
 * closes, since a page can put a long inline script ahead of its `<title>`,
 * and no further than `MAX_BYTES`; a file iCloud keeps only in the cloud is skipped rather than downloaded: a
 * folder of them is listed, not fetched. A title is kept by the file's path,
 * size and mtime, so a folder read again on the listing's clock costs a stat
 * per file, and a file written since is read again.
 */
export async function computerFileTitles(
  paths: readonly string[],
): Promise<Record<string, string>> {
  const titles: Record<string, string> = {};
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const filePath = paths[next];
      next += 1;
      if (filePath === undefined) continue;
      const title = await titleOf(filePath).catch(() => null);
      if (title) titles[filePath] = title;
    }
  };
  await Promise.all(Array.from({ length: READERS }, worker));
  return titles;
}

/** How many files are read at once. */
const READERS = 8;
/** How much of a file is read at a time for its title. */
const CHUNK_BYTES = 16 * 1024;
/** How far into a file its title is looked for. */
const MAX_BYTES = 512 * 1024;
/** Where a page's or a Markdown file's title has been read far enough. */
const PAGE_TITLE_END = /<\/(?:title|h1)\s*>/i;
const MARKDOWN_TITLE_END = /^#{1,6}[ \t]+\S.*\n/m;
/** Titles kept, oldest let go first. */
const KEPT = 5000;
const kept = new Map<string, null | string>();

const PAGE_EXTENSIONS = new Set([".htm", ".html", ".xhtml"]);
const MARKDOWN_EXTENSIONS = new Set([".markdown", ".md", ".mdx"]);

/** Whether a file is one this reads a title out of, by its name alone. */
function hasOwnTitle(name: string) {
  const extension = path.extname(name).toLowerCase();
  return PAGE_EXTENSIONS.has(extension) || MARKDOWN_EXTENSIONS.has(extension);
}

async function titleOf(filePath: string): Promise<null | string> {
  if (!hasOwnTitle(filePath)) return null;
  const stat = await fs.stat(filePath);
  // A file with a size and no blocks on disk is one iCloud evicted. Windows
  // reports no blocks for every file.
  const evicted =
    process.platform === "darwin" && stat.size > 0 && stat.blocks === 0;
  if (!stat.isFile() || evicted) return null;
  const key = `${filePath}\0${stat.size}\0${stat.mtimeMs}`;
  if (kept.has(key)) return kept.get(key) ?? null;
  const isPage = PAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
  const head = await readHead(
    filePath,
    Math.min(MAX_BYTES, stat.size),
    isPage ? PAGE_TITLE_END : MARKDOWN_TITLE_END,
  );
  const title = isPage ? (pageTitle(head) ?? null) : markdownTitle(head);
  if (kept.size >= KEPT) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  }
  kept.set(key, title);
  return title;
}

/** The top of a file, read until `end` matches or `limit` bytes are in. */
async function readHead(filePath: string, limit: number, end: RegExp) {
  const handle = await fs.open(filePath, "r");
  const decoder = new TextDecoder();
  const buffer = Buffer.alloc(CHUNK_BYTES);
  let head = "";
  let at = 0;
  try {
    while (at < limit && !end.test(head)) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(CHUNK_BYTES, limit - at),
        at,
      );
      if (bytesRead === 0) break;
      at += bytesRead;
      head += decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
    }
  } finally {
    await handle.close();
  }
  return head;
}

/** A Markdown file's front matter `title:`, or its first heading. */
export function markdownTitle(markdown: string): null | string {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  const declared = front?.[1]
    ? /^title:\s*(.+)$/m
        .exec(front[1])?.[1]
        ?.trim()
        .replace(/^(["'])(.*)\1$/, "$2")
    : undefined;
  const body = front ? markdown.slice(front[0].length) : markdown;
  const heading = /^#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(body)?.[1];
  return (
    plainText(declared) ?? plainText(heading?.replace(/[*_`]/g, "")) ?? null
  );
}
