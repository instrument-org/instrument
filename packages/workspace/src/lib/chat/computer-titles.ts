import fs from "node:fs/promises";
import path from "node:path";

/**
 * The titles pages on this computer give themselves, for a folder listed by
 * them rather than by their names: a page's `<title>` (or its first `<h1>`),
 * a Markdown file's front matter `title:` (or its first heading).
 *
 * Only the head of each file is read, since that is where a title is, and a
 * file iCloud keeps only in the cloud is skipped rather than downloaded: a
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
/** How much of a file's head is read for its title. */
const HEAD_BYTES = 16 * 1024;
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
  const handle = await fs.open(filePath, "r");
  let head: string;
  try {
    const buffer = Buffer.alloc(Math.min(HEAD_BYTES, stat.size));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    head = buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
  const title = PAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
    ? pageTitle(head)
    : markdownTitle(head);
  if (kept.size >= KEPT) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  }
  kept.set(key, title);
  return title;
}

/** A page's `<title>`, or its first `<h1>` where it has none. */
export function pageTitle(html: string): null | string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  return plain(title) ?? plain(heading);
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
  return plain(declared) ?? plain(heading?.replace(/[*_`]/g, ""));
}

/** Text with its tags taken out, its entities read, and its spaces collapsed; null when nothing is left. */
function plain(text: string | undefined): null | string {
  if (text === undefined) return null;
  const words = decodeEntities(text.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
  return words === "" ? null : words;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  rsquo: "’",
};

function decodeEntities(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#")) {
      const code =
        name[1]?.toLowerCase() === "x"
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10_ff_ff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}
