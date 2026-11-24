import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";

import { isPublicPage } from "@/electron-main/browser-view/page-title-fetch";

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
 * Only the host is ever sent to the proxy. A page's path and query are the half
 * worth keeping private, and an icon belongs to the site.
 *
 * The proxy draws an SVG icon as a bitmap on solid white, so a site's own SVG
 * is drawn in place of the proxy's bitmap wherever there is one, in this order:
 *
 * 1. The SVG a page named for itself when it was opened in one of the app's
 *    browser tabs, kept apart for the theme it was opened in, since a page may
 *    name another file in dark.
 * 2. The SVG the proxy says its bitmap was made from, fetched from where the
 *    proxy found it.
 * 3. The proxy's bitmap.
 *
 * An SVG that cannot be seen in the theme (dark ink on nothing, in dark) is
 * passed over for the next. A page's other icons, not SVGs, are kept only for
 * a site the proxy has nothing for.
 *
 * The second is the one request the app makes to a site nobody opened, and it
 * is made because a model can name a host: it goes only to a public https
 * address the proxy already knew, with no cookies, referrer or redirect.
 */

const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_SVG_BYTES = 256 * 1024;
/**
 * The size asked of the proxy: large enough for an app's biggest plate on a
 * 2x screen. The proxy answers with the largest it has up to this, so a site
 * with only a small icon still gets that one rather than an upscale.
 */
const PROXY_ICON_SIZE = 256;

/** A hostname as the renderer sends it: lowercase labels, no port, nothing to climb out of the folder with. */
const HOST_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

const StoredSchema = z.discriminatedUnion("found", [
  z.object({ at: z.number(), found: z.literal(false) }),
  // The size the proxy was asked for when this was kept. An icon kept while
  // it was asked for another reads as never kept, so it is fetched again.
  z.object({
    at: z.number(),
    found: z.literal(true),
    size: z.literal(PROXY_ICON_SIZE),
    type: z.string(),
    // Whether the proxy's answer was read for the SVG it was made from. An
    // icon kept before that was read is served and fetched again behind it.
    readForSvg: z.boolean().optional(),
  }),
]);

/** Beside a kept SVG: where it came from, and what is known about drawing it. */
const StoredSvgSchema = z.object({
  at: z.number(),
  /** Whether the page that named it was its site's front page. */
  isFrontPage: z.boolean().optional(),
  /** Whether it can be seen, for each theme it was measured in. */
  legible: z.object({
    dark: z.boolean().optional(),
    light: z.boolean().optional(),
  }),
  url: z.string(),
});

export interface Deps {
  dir: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Whether an SVG can be seen in a theme; undefined when that could not be told. */
  isLegible: (svg: Buffer, theme: Theme) => Promise<boolean | undefined>;
  now: () => number;
  /** The addresses a host name stands for. */
  resolveHost: (host: string) => Promise<string[]>;
}

export type Theme = "dark" | "light";

/** Which of a host's SVGs: the proxy's, or a page's as it was in a theme. */
type SvgSlot = "page-dark" | "page-light" | "proxy";

type StoredSvg = z.output<typeof StoredSvgSchema>;

interface SiteIcon {
  bytes: Buffer;
  type: string;
}

type Stored = z.output<typeof StoredSchema>;

const inFlight = new Map<string, Promise<"failed" | "none" | SiteIcon>>();

/**
 * Keeps the icon a page named for itself: an SVG over whatever the proxy has,
 * and any other only for a site the proxy has nothing for. Told by a browser
 * tab whenever its page names its icons; says whether the site's icon may be
 * another than before, so the caller can draw it.
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
  const icons = iconUrls.filter((iconUrl) =>
    /^https?:$/.test(URL.parse(iconUrl)?.protocol ?? ""),
  );
  const svg = icons.find((iconUrl) => isSvgUrl(iconUrl));
  if (svg !== undefined && isSiteIconHost(host) && !isLocalHost(host)) {
    return rememberPageSvg({ host, page, svg, theme }, deps);
  }
  const [iconUrl] = icons;
  if (iconUrl === undefined) {
    return false;
  }
  try {
    if (await siteIconFor(host, theme, deps)) {
      return false;
    }
  } catch {
    // The proxy could not be asked; the page's own icon is no worse a guess.
  }
  if (!isSiteIconHost(host) || isLocalHost(host)) {
    return false;
  }
  try {
    const response = await deps.fetch(iconUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim();
    if (!response.ok || !type?.startsWith("image/")) {
      return false;
    }
    await keep(
      host,
      { bytes: Buffer.from(await response.arrayBuffer()), type },
      deps,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * A host can serve several products, each naming an icon of its own, so the
 * site's is its front page's, and until that is opened the first page's to
 * name one.
 */
async function rememberPageSvg(
  {
    host,
    page,
    svg,
    theme,
  }: { host: string; page: URL; svg: string; theme: Theme },
  deps: Deps,
): Promise<boolean> {
  const slot: SvgSlot = `page-${theme}`;
  const isFrontPage = page.pathname === "/";
  const kept = (await readSvg(host, slot, deps.dir))?.stored;
  if (kept) {
    const isFresh = deps.now() - kept.at < FOUND_TTL_MS;
    const isOthers = kept.url !== svg && kept.isFrontPage && !isFrontPage;
    const isSettled = kept.url === svg || !isFrontPage;
    if (isOthers || (isSettled && isFresh)) {
      return false;
    }
  }
  const bytes = await fetchSvg(svg, deps, { trustedHost: host });
  if (!bytes) {
    return false;
  }
  await keepSvg(
    host,
    slot,
    bytes,
    { isFrontPage: isFrontPage || kept?.isFrontPage, url: svg },
    deps,
  );
  return true;
}

/**
 * The icon for a host in a theme: a kept or fresh one of its own or the
 * proxy's, or none. Throws when there is no copy and the proxy could not be
 * reached, so the caller can answer "not now" rather than "never".
 */
export async function siteIconFor(
  host: string,
  theme: Theme,
  deps: Deps,
): Promise<SiteIcon | undefined> {
  if (!isSiteIconHost(host) || isLocalHost(host)) {
    return undefined;
  }
  const otherTheme: Theme = theme === "dark" ? "light" : "dark";
  const own =
    (await legibleSvg(host, `page-${theme}`, theme, deps)) ??
    (await legibleSvg(host, `page-${otherTheme}`, theme, deps));
  if (own) {
    return own;
  }
  const bitmap = await proxyIconFor(host, deps);
  return bitmap && ((await legibleSvg(host, "proxy", theme, deps)) ?? bitmap);
}

/** The proxy's bitmap for a host, and the SVG it was made from kept beside it. */
async function proxyIconFor(
  host: string,
  deps: Deps,
): Promise<SiteIcon | undefined> {
  const stored = await readStored(host, deps.dir);
  const age = stored ? deps.now() - stored.at : Number.POSITIVE_INFINITY;

  if (stored && !stored.found && age < NONE_TTL_MS) {
    return undefined;
  }
  const kept = stored?.found
    ? await readBytes(host, stored.type, deps.dir)
    : undefined;
  if (kept && stored?.found && stored.readForSvg && age < FOUND_TTL_MS) {
    return kept;
  }
  if (kept) {
    // Stale: served as it is, and fetched again behind it.
    void refresh(host, deps).catch(() => {
      // A refresh that fails leaves the stale copy standing.
    });
    return kept;
  }

  const fetched = await refresh(host, deps);
  if (fetched === "failed") {
    throw new Error(`Could not reach the favicon proxy for ${host}`);
  }
  return fetched === "none" ? undefined : fetched;
}

/** A host's kept SVG, when it can be seen in the theme. */
async function legibleSvg(
  host: string,
  slot: SvgSlot,
  theme: Theme,
  deps: Deps,
): Promise<SiteIcon | undefined> {
  const kept = await readSvg(host, slot, deps.dir);
  if (!kept) {
    return undefined;
  }
  let legible = kept.stored.legible[theme];
  if (legible === undefined) {
    legible = await deps.isLegible(kept.bytes, theme);
    if (legible !== undefined) {
      await recordLegible(host, slot, { legible, theme }, kept.stored, deps);
    }
  }
  return legible ? { bytes: kept.bytes, type: "image/svg+xml" } : undefined;
}

/** Writes down a measure, unless the SVG it was taken of has been replaced. */
async function recordLegible(
  host: string,
  slot: SvgSlot,
  { legible, theme }: { legible: boolean; theme: Theme },
  measured: StoredSvg,
  deps: Deps,
) {
  const current = (await readSvg(host, slot, deps.dir))?.stored;
  if (current?.at === measured.at && current.url === measured.url) {
    await writeWhole(
      svgMetaPath(host, slot, deps.dir),
      JSON.stringify({
        ...current,
        legible: { ...current.legible, [theme]: legible },
      } satisfies StoredSvg),
    );
  }
}

/**
 * An SVG icon's bytes, when it is one and may be asked for: a public https
 * address, or the opened site's own. Nothing of the person's goes with it.
 */
async function fetchSvg(
  url: string,
  deps: Deps,
  { trustedHost }: { trustedHost?: string } = {},
): Promise<Buffer | undefined> {
  const { hostname, protocol } = new URL(url);
  if (hostname !== trustedHost) {
    if (protocol !== "https:" || !isPublicPage(url)) {
      return undefined;
    }
    try {
      const addresses = await deps.resolveHost(hostname);
      if (
        addresses.length === 0 ||
        !addresses.every((address) => isPublicAddress(address))
      ) {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }
  try {
    const response = await deps.fetch(url, {
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim();
    if (!response.ok || !response.body || type !== "image/svg+xml") {
      await response.body?.cancel();
      return undefined;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_SVG_BYTES) {
        return undefined;
      }
      chunks.push(chunk);
    }
    return size > 0 ? Buffer.concat(chunks) : undefined;
  } catch {
    return undefined;
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

async function keepSvg(
  host: string,
  slot: SvgSlot,
  bytes: Buffer,
  { isFrontPage, url }: { isFrontPage?: boolean; url: string },
  deps: Deps,
) {
  await fs.mkdir(deps.dir, { recursive: true });
  // The old one's record goes first, so no measure of it is read for the new.
  await fs.rm(svgMetaPath(host, slot, deps.dir), { force: true });
  await writeWhole(svgPath(host, slot, deps.dir), bytes);
  await writeWhole(
    svgMetaPath(host, slot, deps.dir),
    JSON.stringify({
      at: deps.now(),
      ...(isFrontPage !== undefined && { isFrontPage }),
      legible: {},
      url,
    } satisfies StoredSvg),
  );
}

async function forgetSvg(host: string, slot: SvgSlot, dir: string) {
  await fs.rm(svgMetaPath(host, slot, dir), { force: true });
  await fs.rm(svgPath(host, slot, dir), { force: true });
}

async function readSvg(
  host: string,
  slot: SvgSlot,
  dir: string,
): Promise<{ bytes: Buffer; stored: StoredSvg } | undefined> {
  try {
    const parsed = StoredSvgSchema.safeParse(
      JSON.parse(await fs.readFile(svgMetaPath(host, slot, dir), "utf8")),
    );
    return parsed.success
      ? {
          bytes: await fs.readFile(svgPath(host, slot, dir)),
          stored: parsed.data,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

// A host has no underscore in it, so no host's files are another's.
function svgMetaPath(host: string, slot: SvgSlot, dir: string) {
  return path.join(dir, `${host}_${slot}.json`);
}

function svgPath(host: string, slot: SvgSlot, dir: string) {
  return path.join(dir, `${host}_${slot}.svg`);
}

/** Written to a temp name and moved into place, so a reader never sees half. */
async function writeWhole(target: string, content: Buffer | string) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, content);
  await fs.rename(temporary, target);
}

function bytesPath(host: string, dir: string) {
  return path.join(dir, `${host}.icon`);
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
    // An icon a page gave for itself stands until the proxy has one.
    const stored = await readStored(host, deps.dir);
    const kept = stored?.found
      ? await readBytes(host, stored.type, deps.dir)
      : undefined;
    if (stored?.found && kept) {
      await writeStored(
        host,
        { ...stored, at: deps.now(), readForSvg: true },
        deps.dir,
      );
      return kept;
    }
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
  const origin = response.headers.get("content-location");
  if (origin && URL.canParse(origin) && isSvgUrl(origin)) {
    const svg = await fetchSvg(origin, deps);
    // One that cannot be had just now leaves the last one standing.
    if (svg) {
      await keepSvg(host, "proxy", svg, { url: origin }, deps);
    }
  } else {
    await forgetSvg(host, "proxy", deps.dir);
  }
  return keep(host, { bytes, type }, deps);
}

/** A host the proxy cannot see: this machine, or an address rather than a name. */
function isLocalHost(host: string) {
  return (
    host === "localhost" || host.endsWith(".localhost") || /^[\d.]+$/.test(host)
  );
}

function isSiteIconHost(host: string): boolean {
  return HOST_PATTERN.test(host);
}

async function keep(host: string, icon: SiteIcon, deps: Deps) {
  await fs.mkdir(deps.dir, { recursive: true });
  await writeWhole(bytesPath(host, deps.dir), icon.bytes);
  await writeStored(
    host,
    {
      at: deps.now(),
      found: true,
      readForSvg: true,
      size: PROXY_ICON_SIZE,
      type: icon.type,
    },
    deps.dir,
  );
  return icon;
}

function metaPath(host: string, dir: string) {
  return path.join(dir, `${host}.json`);
}

function proxyUrl(host: string) {
  const origin = encodeURIComponent(`https://${host}`);
  return `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${origin}&size=${PROXY_ICON_SIZE}`;
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

async function writeStored(host: string, stored: Stored, dir: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(metaPath(host, dir), JSON.stringify(stored));
}
