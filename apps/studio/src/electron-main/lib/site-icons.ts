import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";

import { siteOf } from "@/shared/site-of";
import { isPublicPage } from "@/electron-main/browser-view/page-title-fetch";

/**
 * Site icons, fetched once and kept on disk.
 *
 * The renderer draws a site's icon from `instrument://site-icon/<host>`, and
 * this answers it: from the copy on disk when there is one, and otherwise by
 * asking the icon service once and keeping what it says. A row of chips then
 * costs a read from disk rather than a request per chip per mount, so icons are
 * there when the row is, on every launch after the first sighting.
 *
 * What the service says is a site's icon is its icon: it has one per theme,
 * made to be seen there, and the app does nothing to it. The answer is kept for
 * as long as the service says, then served as it is while it is asked for
 * again. A request that failed says nothing about the site, so it is never
 * kept.
 *
 * Where the service has none, or cannot be asked and nothing is kept, the icon
 * is the one a page named for itself when it was opened in one of the app's
 * browser tabs. Failing that too, Google's stands in for a service that cannot
 * be asked, for a few minutes.
 *
 * Only the host is ever sent to either. A page's path and query are the half
 * worth keeping private, and an icon belongs to the site.
 */

const ICON_SERVICE = "https://icons.tryinstrument.com";
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** How long an answer that does not say is kept, and the most one may say. */
const DEFAULT_TTL_MS = DAY_MS;
const MAX_TTL_MS = 30 * DAY_MS;
const STAND_IN_TTL_MS = 5 * MINUTE_MS;
const PAGE_ICON_TTL_MS = 30 * DAY_MS;
const FETCH_TIMEOUT_MS = 10_000;
const SVG_TYPE = "image/svg+xml";
const MAX_SVG_BYTES = 256 * 1024;
const MAX_BITMAP_BYTES = 1024 * 1024;
/** How many of a page's icons are tried for a site the service has none for. */
const MAX_PAGE_ICONS = 3;
/** The size asked of Google, whose answer is the largest it has up to this. */
const STAND_IN_SIZE = 256;

/** A hostname as the renderer sends it: lowercase labels, no port, nothing to climb out of the folder with. */
const HOST_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

const StoredSchema = z.object({
  at: z.number(),
  /** The icon's type; undefined where the service said the site has none. */
  type: z.string().optional(),
  ttl: z.number(),
});

export interface Deps {
  dir: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  /** The addresses a host name stands for. */
  resolveHost: (host: string) => Promise<string[]>;
}

export type Theme = "dark" | "light";

/** Which of a host's kept icons: the service's in a theme, or its page's. */
type Slot = "page-dark" | "page-light" | "served-dark" | "served-light";

type Stored = z.output<typeof StoredSchema>;

export interface SiteIcon {
  bytes: Buffer;
  type: string;
}

const inFlight = new Map<string, Promise<"failed" | "none" | SiteIcon>>();

/** Page icons that could not be fetched this session, not asked for again. */
const failedPageIcons = new Set<string>();

/**
 * Keeps the icon a page named for itself, for a site the service has none for.
 * Told by a browser tab whenever its page names its icons; says whether the
 * site's icon may be another than before, so the caller can draw it.
 */
export async function rememberPageIcon(
  {
    iconUrls,
    pageUrl,
    theme,
  }: { iconUrls: string[]; pageUrl: string; theme: Theme },
  deps: Deps,
): Promise<boolean> {
  const page = URL.parse(pageUrl);
  if (!page || !/^https?:$/.test(page.protocol)) {
    return false;
  }
  const host = page.hostname;
  if (!isSiteIconHost(host)) {
    return false;
  }
  const icons = iconUrls.filter((iconUrl) =>
    /^https?:$/.test(URL.parse(iconUrl)?.protocol ?? ""),
  );
  try {
    if (icons.length === 0 || (await servedIcon(host, theme, deps))) {
      return false;
    }
  } catch {
    // The service could not be asked; the page's own icon can be drawn until it can.
  }
  const site = siteOf(host);
  const slot: Slot = `page-${theme}`;
  const kept = await readStored(site, slot, deps.dir);
  if (kept && deps.now() - kept.at < kept.ttl) {
    return false;
  }
  for (const url of [
    ...icons.filter((iconUrl) => isSvgUrl(iconUrl)),
    ...icons.filter((iconUrl) => !isSvgUrl(iconUrl)),
  ].slice(0, MAX_PAGE_ICONS)) {
    if (failedPageIcons.has(url)) {
      continue;
    }
    const icon = await fetchPageIcon(url, host, deps);
    if (icon) {
      await keep(site, slot, icon, PAGE_ICON_TTL_MS, deps);
      return true;
    }
    failedPageIcons.add(url);
  }
  return false;
}

/**
 * The icon for a host in a theme, or none. Throws when there is no copy and
 * the service could not be reached, so the caller can answer "not now" rather
 * than "never".
 */
export async function siteIconFor(
  host: string,
  theme: Theme,
  deps: Deps,
): Promise<SiteIcon | undefined> {
  if (!isSiteIconHost(host)) {
    return undefined;
  }
  let failure: Error | undefined;
  try {
    const served = await servedIcon(host, theme, deps);
    if (served) {
      return served;
    }
  } catch (error) {
    failure =
      error instanceof Error ? error : new Error("No icon", { cause: error });
  }
  const other: Theme = theme === "dark" ? "light" : "dark";
  for (const slot of [`page-${theme}`, `page-${other}`] as const) {
    const kept = await readIcon(siteOf(host), slot, deps.dir);
    if (kept) {
      return kept;
    }
  }
  if (failure === undefined) {
    return undefined;
  }
  const standIn = await fetchStandIn(host, deps);
  if (!standIn) {
    throw failure;
  }
  await keep(host, `served-${theme}`, standIn, STAND_IN_TTL_MS, deps);
  return standIn;
}

/** The service's icon for a host, kept or fresh. */
async function servedIcon(
  host: string,
  theme: Theme,
  deps: Deps,
): Promise<SiteIcon | undefined> {
  if (!isPublicPage(`https://${host}/`)) {
    return undefined;
  }
  const slot: Slot = `served-${theme}`;
  const stored = await readStored(host, slot, deps.dir);
  const kept = stored?.type ? await readIcon(host, slot, deps.dir) : undefined;
  if (stored && (kept || !stored.type)) {
    if (deps.now() - stored.at >= stored.ttl) {
      // Stale: served as it is, and asked for again behind it. One that fails
      // leaves the stale answer standing.
      void refresh(host, theme, deps).catch(() => undefined);
    }
    return kept;
  }
  const fetched = await refresh(host, theme, deps);
  if (fetched === "failed") {
    throw new Error(`Could not reach the icon service for ${host}`);
  }
  return fetched === "none" ? undefined : fetched;
}

/** One request per host and theme at a time, however many rows ask at once. */
function refresh(host: string, theme: Theme, deps: Deps) {
  const key = `${host} ${theme}`;
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }
  const run = fetchServed(host, theme, deps).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, run);
  return run;
}

async function fetchServed(
  host: string,
  theme: Theme,
  deps: Deps,
): Promise<"failed" | "none" | SiteIcon> {
  try {
    const response = await ask(
      `${ICON_SERVICE}/v1/${host}?theme=${theme}`,
      deps,
    );
    const isNone = response.status === 404 || response.status === 400;
    if (!response.ok && !isNone) {
      await response.body?.cancel();
      return "failed";
    }
    const slot: Slot = `served-${theme}`;
    const ttl = ttlOf(response);
    if (isNone) {
      await response.body?.cancel();
      await writeStored(host, slot, { at: deps.now(), ttl }, deps.dir);
      return "none";
    }
    const icon = await iconOf(response);
    if (!icon) {
      return "failed";
    }
    await keep(host, slot, icon, ttl, deps);
    return icon;
  } catch {
    return "failed";
  }
}

async function fetchStandIn(host: string, deps: Deps) {
  const origin = encodeURIComponent(`https://${host}`);
  try {
    const response = await ask(
      `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${origin}&size=${STAND_IN_SIZE}`,
      deps,
    );
    if (response.ok) {
      return await iconOf(response);
    }
    await response.body?.cancel();
  } catch {
    // Nothing stands in.
  }
  return undefined;
}

function ask(url: string, deps: Deps, init?: RequestInit) {
  return deps.fetch(url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    ...init,
  });
}

/** How long an answer says it may be kept. */
function ttlOf(response: Response) {
  const seconds = /\bmax-age=(\d+)/.exec(
    response.headers.get("cache-control") ?? "",
  )?.[1];
  return seconds === undefined
    ? DEFAULT_TTL_MS
    : Math.min(Number(seconds) * 1000, MAX_TTL_MS);
}

/** An answer's image, where it is one of a size an icon has. */
async function iconOf(response: Response): Promise<SiteIcon | undefined> {
  const type = response.headers.get("content-type")?.split(";")[0]?.trim();
  if (!response.ok || !response.body || !type?.startsWith("image/")) {
    await response.body?.cancel();
    return undefined;
  }
  const max = type === SVG_TYPE ? MAX_SVG_BYTES : MAX_BITMAP_BYTES;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > max) {
      return undefined;
    }
    chunks.push(chunk);
  }
  return size > 0 ? { bytes: Buffer.concat(chunks), type } : undefined;
}

/**
 * A page's icon from an address that may be asked: a public https one, or the
 * opened site's own. Nothing of the person's goes with it.
 */
async function fetchPageIcon(
  url: string,
  openedHost: string,
  deps: Deps,
): Promise<SiteIcon | undefined> {
  const { hostname, protocol } = new URL(url);
  try {
    if (hostname !== openedHost) {
      if (protocol !== "https:" || !isPublicPage(url)) {
        return undefined;
      }
      const addresses = await within(
        FETCH_TIMEOUT_MS,
        deps.resolveHost(hostname),
      );
      if (
        !addresses?.length ||
        !addresses.every((address) => isPublicAddress(address))
      ) {
        return undefined;
      }
    }
    return await iconOf(
      await ask(url, deps, { redirect: isSvgUrl(url) ? "error" : "follow" }),
    );
  } catch {
    return undefined;
  }
}

/** What a promise comes to, when it does in time. */
async function within<T>(ms: number, promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          resolve(undefined);
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** An address outside this computer and its network. */
function isPublicAddress(address: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  const plain = mapped ?? address;
  if (plain.includes(":")) {
    // Everything a site on the internet has is in 2000::/3.
    return /^[23][0-9a-f]{3}:/i.test(plain);
  }
  return isPublicPage(`https://${plain}/`);
}

function isSvgUrl(url: string) {
  return /\.svg$/i.test(URL.parse(url)?.pathname ?? "");
}

/** A host an icon is kept for: a name, and not this machine's. */
function isSiteIconHost(host: string): boolean {
  return (
    HOST_PATTERN.test(host) &&
    host !== "localhost" &&
    !host.endsWith(".localhost") &&
    !/^[\d.]+$/.test(host)
  );
}

async function keep(
  host: string,
  slot: Slot,
  { bytes, type }: SiteIcon,
  ttl: number,
  deps: Deps,
) {
  await fs.mkdir(deps.dir, { recursive: true });
  await writeWhole(bytesPath(host, slot, deps.dir), bytes);
  await writeStored(host, slot, { at: deps.now(), ttl, type }, deps.dir);
}

async function readIcon(
  host: string,
  slot: Slot,
  dir: string,
): Promise<SiteIcon | undefined> {
  const stored = await readStored(host, slot, dir);
  if (stored?.type === undefined) {
    return undefined;
  }
  try {
    const bytes = await fs.readFile(bytesPath(host, slot, dir));
    return { bytes, type: stored.type };
  } catch {
    return undefined;
  }
}

async function readStored(
  host: string,
  slot: Slot,
  dir: string,
): Promise<Stored | undefined> {
  try {
    const parsed = StoredSchema.safeParse(
      JSON.parse(await fs.readFile(metaPath(host, slot, dir), "utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function writeStored(
  host: string,
  slot: Slot,
  stored: Stored,
  dir: string,
) {
  await fs.mkdir(dir, { recursive: true });
  await writeWhole(metaPath(host, slot, dir), JSON.stringify(stored));
}

/** Written to a temp name and moved into place, so a reader never sees half. */
async function writeWhole(target: string, content: Buffer | string) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, content);
  await fs.rename(temporary, target);
}

// A host has no underscore in it, so no host's files are another's.
function metaPath(host: string, slot: Slot, dir: string) {
  return path.join(dir, `${host}_${slot}.kept.json`);
}

function bytesPath(host: string, slot: Slot, dir: string) {
  return path.join(dir, `${host}_${slot}.icon`);
}
