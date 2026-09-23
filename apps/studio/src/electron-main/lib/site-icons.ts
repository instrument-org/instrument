import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * Site icons, fetched once and kept on disk.
 *
 * The renderer draws a site's icon from `instrument://site-icon/<host>`, and
 * this answers it: from the copy on disk when there is one, and otherwise by
 * asking the favicon proxy once and keeping what it says. A row of chips then
 * costs a read from disk rather than a request per chip per mount, so icons are
 * there when the row is, on every launch after the first sighting.
 *
 * Three answers, kept apart. A found icon is kept for a month and served stale
 * while it is fetched again. The proxy saying it has nothing (a 404, whatever
 * size of stand-in comes with it) is kept for a week. A request that failed says
 * nothing about the site, so it is never kept: the copy on disk is served if
 * there is one, and otherwise the renderer is told to try again later.
 *
 * Only the host is ever sent anywhere, and only to the proxy. A page's path and
 * query are the half worth keeping private, and an icon belongs to the site.
 */

const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

/** A hostname as the renderer sends it: lowercase labels, no port, nothing to climb out of the folder with. */
const HOST_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

const StoredSchema = z.discriminatedUnion("found", [
  z.object({ at: z.number(), found: z.literal(false) }),
  z.object({ at: z.number(), found: z.literal(true), type: z.string() }),
]);
type Stored = z.output<typeof StoredSchema>;

interface SiteIcon {
  bytes: Buffer;
  type: string;
}

interface Deps {
  dir: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
}

const inFlight = new Map<string, Promise<"failed" | "none" | SiteIcon>>();

function isSiteIconHost(host: string): boolean {
  return HOST_PATTERN.test(host);
}

/**
 * The icon for a host: the kept copy, a fresh one from the proxy, or none.
 * Throws when there is no copy and the proxy could not be reached, so the
 * caller can answer "not now" rather than "never".
 */
export async function siteIconFor(
  host: string,
  deps: Deps,
): Promise<SiteIcon | undefined> {
  if (!isSiteIconHost(host) || isLocalHost(host)) {
    return undefined;
  }
  const stored = await readStored(host, deps.dir);
  const age = stored ? deps.now() - stored.at : Number.POSITIVE_INFINITY;

  if (stored && !stored.found && age < NONE_TTL_MS) {
    return undefined;
  }
  const kept = stored?.found
    ? await readBytes(host, stored.type, deps.dir)
    : undefined;
  if (kept && age < FOUND_TTL_MS) {
    return kept;
  }
  if (kept) {
    // Stale: served as it is, and fetched again behind it.
    void refresh(host, deps).catch(() => undefined);
    return kept;
  }

  const fetched = await refresh(host, deps);
  if (fetched === "failed") {
    throw new Error(`Could not reach the favicon proxy for ${host}`);
  }
  return fetched === "none" ? undefined : fetched;
}

/** One fetch per host at a time, however many rows ask at once. */
function refresh(host: string, deps: Deps) {
  const pending = inFlight.get(host);
  if (pending) {
    return pending;
  }
  const run = fetchAndKeep(host, deps).finally(() => {
    inFlight.delete(host);
  });
  inFlight.set(host, run);
  return run;
}

async function fetchAndKeep(
  host: string,
  deps: Deps,
): Promise<"failed" | "none" | SiteIcon> {
  let response: Response;
  try {
    response = await deps.fetch(proxyUrl(host), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return "failed";
  }
  if (response.status === 404) {
    await writeStored(host, { at: deps.now(), found: false }, deps.dir);
    return "none";
  }
  if (!response.ok) {
    return "failed";
  }
  const type =
    response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  if (!type.startsWith("image/")) {
    return "failed";
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(deps.dir, { recursive: true });
  // Written to a temp name and moved into place, so a reader never sees half.
  const target = bytesPath(host, deps.dir);
  const temporary = `${target}.${process.pid}.${deps.now()}.tmp`;
  await fs.writeFile(temporary, bytes);
  await fs.rename(temporary, target);
  await writeStored(host, { at: deps.now(), found: true, type }, deps.dir);
  return { bytes, type };
}

function proxyUrl(host: string) {
  const origin = encodeURIComponent(`https://${host}`);
  return `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${origin}&size=64`;
}

/** A host the proxy cannot see: this machine, or an address rather than a name. */
function isLocalHost(host: string) {
  return (
    host === "localhost" || host.endsWith(".localhost") || /^[\d.]+$/.test(host)
  );
}

function metaPath(host: string, dir: string) {
  return path.join(dir, `${host}.json`);
}

function bytesPath(host: string, dir: string) {
  return path.join(dir, `${host}.icon`);
}

async function readStored(
  host: string,
  dir: string,
): Promise<Stored | undefined> {
  try {
    const parsed = StoredSchema.safeParse(
      JSON.parse(await fs.readFile(metaPath(host, dir), "utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function readBytes(
  host: string,
  type: string,
  dir: string,
): Promise<SiteIcon | undefined> {
  try {
    return { bytes: await fs.readFile(bytesPath(host, dir)), type };
  } catch {
    return undefined;
  }
}

async function writeStored(host: string, stored: Stored, dir: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(metaPath(host, dir), JSON.stringify(stored));
}
