import { PAGES_DOMAIN } from "@instrument-org/shared";
import { pageTitle } from "@instrument-org/workspace/page-title";
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

import { cleanName } from "../browser-view/save-page-format";
import { markFromInternet } from "./download-mark";
import { logger } from "./electron-logger";

/**
 * A page hosted at `https://<id>.instrument.page/`, which a `page` link from
 * outside names by its id: fetched from that host and no other, kept as a
 * copy in the person's Downloads folder, marked as a browser marks what it
 * saves, and opened from there. The copy is safe to open straight from a
 * link because a page in Downloads reaches only itself
 * (`local-file-policy.ts`). See `docs/architecture/deep-links.md`.
 */

/** How long the host has to send the whole page. */
const TIMEOUT_MS = 30_000;

/** The largest page kept: one self-contained file, pictures included. */
const MAX_BYTES = 16 * 1024 * 1024;

/** How many times the host may send the request on, each to itself. */
const MAX_REDIRECTS = 3;

/**
 * Names Windows keeps for devices, which a file cannot have whatever its
 * extension; a page titled so is kept under its id.
 */
const DEVICE_NAMES = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i;

const log = logger.scope("outside-link");

/** The one address a hosted page has. */
export function hostedPageUrl(id: string): string {
  return `https://${id}.${PAGES_DOMAIN}/`;
}

/**
 * The page's bytes, from its own host only: a redirect to any other origin,
 * an answer other than 200, a page past `MAX_BYTES` or one slower than
 * `TIMEOUT_MS` is a failure, said in a few words for the log.
 */
export async function fetchHostedPage(
  id: string,
  {
    fetch = globalThis.fetch,
    timeoutMs = TIMEOUT_MS,
  }: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): Promise<{ body: Uint8Array } | { failed: string }> {
  const origin = new URL(hostedPageUrl(id)).origin;
  const signal = AbortSignal.timeout(timeoutMs);
  let at = hostedPageUrl(id);
  try {
    let response: Response;
    for (let hop = 0; ; hop++) {
      response = await fetch(at, {
        headers: { accept: "text/html" },
        redirect: "manual",
        signal,
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) {
        break;
      }
      await response.body?.cancel();
      const next = URL.parse(location, at);
      if (hop >= MAX_REDIRECTS || !next || next.origin !== origin) {
        return { failed: "sent the request elsewhere" };
      }
      at = next.href;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      return { failed: `answered ${response.status.toString()}` };
    }
    const length = Number(response.headers.get("content-length"));
    if (length > MAX_BYTES) {
      await response.body?.cancel();
      return { failed: "is too large" };
    }
    const body = response.body ? await readUpTo(response.body) : undefined;
    return body === undefined ? { failed: "is too large" } : { body };
  } catch (error) {
    return {
      failed: signal.aborted
        ? "did not answer in time"
        : `could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** The whole body, or nothing once it runs past `MAX_BYTES`. */
async function readUpTo(
  body: ReadableStream<Uint8Array>,
): Promise<undefined | Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

/**
 * Keeps the page in the person's Downloads folder, where their browser would
 * put it, under its own title (`cleanName`), else its id, with `.html`, and
 * the ` (2)`, ` (3)` a browser adds when the name is taken. The folder is
 * where it really is, so the path kept is the one the folder rule judges.
 * Marked as downloaded from the internet the way the app's own downloads
 * are; a mark that cannot be written leaves the copy as it is. Rejects when
 * the folder takes no file.
 */
export async function keepHostedPage(
  id: string,
  body: Uint8Array,
  {
    downloads = () => app.getPath("downloads"),
    mark = markFromInternet,
  }: {
    downloads?: () => string;
    mark?: (file: string) => Promise<void>;
  } = {},
): Promise<string> {
  const dir = downloads();
  await fs.mkdir(dir, { recursive: true });
  const folder = await fs.realpath(dir);
  const file = await writeUnderFreeName(folder, hostedPageStem(id, body), body);
  try {
    await mark(file);
  } catch (error) {
    log.warn("Left a kept page without its download mark", error);
  }
  return file;
}

/** The copy's name before its extension: the page's title as a file name, else its id. */
export function hostedPageStem(id: string, body: Uint8Array): string {
  const title = pageTitle(new TextDecoder().decode(body));
  const stem = title === undefined ? "" : cleanName(title);
  return stem === "" || DEVICE_NAMES.test(stem) ? id : stem;
}

/**
 * Writes the page under the first free name, which the write itself claims
 * (`wx`), so two links a moment apart never share one file.
 */
async function writeUnderFreeName(
  folder: string,
  stem: string,
  body: Uint8Array,
): Promise<string> {
  for (let copy = 1; ; copy++) {
    const file = path.join(
      folder,
      copy === 1 ? `${stem}.html` : `${stem} (${copy.toString()}).html`,
    );
    try {
      await fs.writeFile(file, body, { flag: "wx" });
      return file;
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      ) {
        throw error;
      }
    }
  }
}
