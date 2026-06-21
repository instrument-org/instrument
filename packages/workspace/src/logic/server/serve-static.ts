import type { Context, Env } from "hono";
import type { ReadStream, Stats } from "node:fs";

import {
  createReadStream,
  statSync,
} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  Readable,
} from "node:stream";

import {
  getMimeType,
} from "../../lib/get-mime-type";

interface ServeStaticFileOptions {
  /**
   * Absolute path to the file to serve
   */
  filePath: string;
  /**
   * Index file name for directory requests (default: 'index.html')
   */
  index?: string;
  /**
   * Whether to support precompressed files
   */
  precompressed?: boolean;
}

const COMPRESSIBLE_CONTENT_TYPE_REGEX =
  // cspell:disable-next-line
  /^\s*(?:text\/[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|wasm|x-httpd-php|x-javascript|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml))(?:[;\s]|$)/i;
const ENCODINGS = {
  br: ".br",
  gzip: ".gz",
  zstd: ".zst",
} as const;
const ENCODINGS_ORDERED_KEYS = Object.keys(
  ENCODINGS,
) as (keyof typeof ENCODINGS)[];

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

const getFileBuffer = async (
  filePath: string,
  signal?: AbortSignal,
): Promise<Buffer | null> => {
  try {
    return await fs.readFile(filePath, { signal });
  } catch {
    return null;
  }
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
  const end = match[2]?.length ? Number.parseInt(match[2], 10) : size - 1;

  if (start < 0 || start >= size || end < start || end >= size) {
    return null;
  }

  return { end, start };
};

// Adapted from https://github.com/honojs/node-server/blob/26f5e89da0abd87752da1f35dc01010f1d428648/src/serve-static.ts#
export async function serveStaticFile<E extends Env = Env>(
  c: Context<E>,
  options: ServeStaticFileOptions,
) {
  const signal = c.req.raw.signal;
  let filePath = options.filePath;
  let stats: Stats | undefined;
  let fileBuffer: Buffer | null = null;

  stats = getStats(filePath);

  if (stats?.isDirectory()) {
    const indexFile = options.index ?? "index.html";
    filePath = path.join(filePath, indexFile);
    stats = getStats(filePath);
  }

  if (!stats) {
    return null;
  }

  // Check for precompressed files
  if (options.precompressed) {
    const mimeType = getMimeType(filePath);
    if (!mimeType || COMPRESSIBLE_CONTENT_TYPE_REGEX.test(mimeType)) {
      const acceptEncodingSet = new Set(
        c.req
          .header("Accept-Encoding")
          ?.split(",")
          .map((encoding) => encoding.trim()),
      );

      for (const encoding of ENCODINGS_ORDERED_KEYS) {
        if (!acceptEncodingSet.has(encoding)) {
          continue;
        }
        const precompressedPath = filePath + ENCODINGS[encoding];
        const precompressedStats = getStats(precompressedPath);
        if (precompressedStats) {
          c.header("Content-Encoding", encoding);
          c.header("Vary", "Accept-Encoding", { append: true });
          stats = precompressedStats;
          filePath = precompressedPath;
          break;
        }
      }
    }
  }

  // Get file buffer if we need it for range requests
  const rangeHeader = c.req.header("range");

  if (rangeHeader) {
    fileBuffer = await getFileBuffer(filePath, signal);
    if (!fileBuffer) {
      return null;
    }
  }

  const size = fileBuffer ? fileBuffer.length : stats.size;
  const mimeType = getMimeType(filePath);
  c.header("Content-Type", mimeType);
  c.header("Accept-Ranges", "bytes");

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

    if (fileBuffer) {
      const chunk = fileBuffer.subarray(start, end + 1);
      c.header("Content-Length", chunkSize.toString());
      c.header("Content-Range", `bytes ${start}-${end}/${size}`);
      return c.body(chunk, 206);
    }
  }

  // Full file response
  c.header("Content-Length", size.toString());
  return c.body(createStreamBody(createReadStream(filePath)), 200);
}
