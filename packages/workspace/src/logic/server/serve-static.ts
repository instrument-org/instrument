import type { Context, Env } from "hono";
import type { ReadStream, Stats } from "node:fs";

import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";

import { getMimeType } from "../../lib/get-mime-type";

interface ServeStaticFileOptions {
  /** Absolute path to the file to serve. */
  filePath: string;
  /** Called with the file's metadata before response streaming begins. */
  onFound: (file: { stats: Stats }) => Promise<void> | void;
}

const createStreamBody = (stream: ReadStream) => {
  return Readable.toWeb(stream) as ReadableStream;
};

const getStats = (filePath: string): Stats | undefined => {
  let stats: Stats | undefined;
  try {
    stats = statSync(filePath);
  } catch {
    /* empty */
  }
  return stats;
};

const parseRange = (
  rangeHeader: string,
  size: number,
): null | { end: number; start: number } => {
  const rangeRegex = /bytes=(\d+)-(\d*)/;
  const match = rangeRegex.exec(rangeHeader);
  if (!match?.[1]) {
    return null;
  }

  const start = Number.parseInt(match[1], 10);
  const asked = match[2]?.length ? Number.parseInt(match[2], 10) : size - 1;

  if (start < 0 || start >= size || asked < start) {
    return null;
  }

  // A range ending past the file is the rest of it (RFC 9110 14.1.2).
  return { end: Math.min(asked, size - 1), start };
};

// Adapted from https://github.com/honojs/node-server/blob/26f5e89da0abd87752da1f35dc01010f1d428648/src/serve-static.ts#
export async function serveStaticFile<E extends Env = Env>(
  c: Context<E>,
  options: ServeStaticFileOptions,
) {
  const { filePath } = options;
  // Exactly the file asked for: a folder is not resolved to an index page.
  const stats = getStats(filePath);
  if (!stats?.isFile()) {
    return null;
  }

  await options.onFound({ stats });

  const mimeType = getMimeType(filePath);
  const rangeHeader = c.req.header("range");
  const size = stats.size;
  c.header("Content-Type", mimeType);
  c.header("Accept-Ranges", "bytes");
  c.header("Last-Modified", stats.mtime.toUTCString());

  if (c.req.method === "HEAD" || c.req.method === "OPTIONS") {
    c.header("Content-Length", size.toString());
    c.status(200);
    return c.body(null);
  }

  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (!range) {
      c.status(416);
      return c.body(null);
    }

    const { end, start } = range;
    const chunkSize = end - start + 1;

    c.header("Content-Length", chunkSize.toString());
    c.header("Content-Range", `bytes ${start}-${end}/${size}`);
    return c.body(
      createStreamBody(createReadStream(filePath, { end, start })),
      206,
    );
  }

  // Full file response
  c.header("Content-Length", size.toString());
  return c.body(createStreamBody(createReadStream(filePath)), 200);
}
