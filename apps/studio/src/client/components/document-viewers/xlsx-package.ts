import {
  configure,
  type FileEntry,
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";

// zip.js starts its workers from a blob URL the renderer's CSP refuses
// (archive.ts), so it inflates on the calling thread.
configure({ useWebWorkers: false });

/**
 * A workbook's bytes with every relationship target made relative, as the
 * spreadsheet engine reads them.
 *
 * Absolute targets (`Target="/xl/drawings/drawing1.xml"`) are valid OPC and
 * are what openpyxl, and so pandas, writes; the engine resolves only relative
 * ones and silently drops the chart, image, comment or table an absolute one
 * points at. A workbook with none comes back as it was, unread past its
 * `.rels` parts.
 */
export async function withRelativeTargets(bytes: Uint8Array) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    const entries = (await reader.getEntries()).filter(
      (entry): entry is FileEntry => !entry.directory,
    );
    const rewritten = new Map<string, string>();
    for (const entry of entries) {
      if (!entry.filename.endsWith(".rels")) {
        continue;
      }
      const xml = await entry.getData(new TextWriter());
      const relative = relativeTargets(entry.filename, xml);
      if (relative !== xml) {
        rewritten.set(entry.filename, relative);
      }
    }
    if (rewritten.size === 0) {
      return bytes;
    }
    // Stored rather than deflated: the copy is only read, once, in memory.
    const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
    for (const entry of entries) {
      const text = rewritten.get(entry.filename);
      await writer.add(
        entry.filename,
        text === undefined
          ? new Uint8ArrayReader(await entry.getData(new Uint8ArrayWriter()))
          : new TextReader(text),
      );
    }
    return await writer.close();
  } finally {
    await reader.close();
  }
}

/** A `.rels` part with each absolute internal target rewritten relative to the part that owns it. */
export function relativeTargets(relsPath: string, xml: string) {
  // `xl/worksheets/_rels/sheet1.xml.rels` belongs to `xl/worksheets/sheet1.xml`,
  // whose targets resolve against `xl/worksheets/`.
  const from = relsPath
    .replace(/(^|\/)_rels\/[^/]+$/, "$1")
    .split("/")
    .filter(Boolean);
  return xml.replaceAll(/<Relationship\b[^>]*>/g, (element) => {
    if (/\bTargetMode="External"/.test(element)) {
      return element;
    }
    return element.replace(
      /(\bTarget=")\/([^"]+)(")/,
      (_match, head: string, target: string, tail: string) => {
        const to = target.split("/");
        let shared = 0;
        while (
          shared < from.length &&
          shared < to.length - 1 &&
          from[shared] === to[shared]
        ) {
          shared += 1;
        }
        const up = from.slice(shared).map(() => "..");
        return `${head}${[...up, ...to.slice(shared)].join("/")}${tail}`;
      },
    );
  });
}
