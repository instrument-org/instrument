import { type WindowTab } from "@/client/atoms/window";
import { joinHostPath } from "@/client/components/window/host-path";
import { matchScreen } from "@/client/components/window/window-href";
import {
  COMPUTER_ROOT,
  fileHref,
  folderHref,
  RECENTS_ROOT,
} from "@/shared/computer-href";
import {
  isScreenName,
  SCREENS,
  type ScreenName,
} from "@/shared/instrument-screens";
import {
  APP_NAME_SLUG,
  expandHomePath,
  filePathOfInstrumentLink,
  instrumentLinkOf,
  instrumentUrlOf,
  isInstrumentAddress,
} from "@instrument-org/shared";

/**
 * A tab's address, the one thing the field shows while it has the caret, a
 * bookmark keeps and a link names: a page's own, and the app's own
 * `instrument://` address for anything else it shows, in the link forms
 * the app already opens (`instrument://chat/<id>`, `instrument://file/<path>`,
 * `instrument://screen/<name>`). Nothing for a tab with nothing to keep: a
 * new tab, a new chat, the recents.
 */
export function instrumentAddressOf(
  tab: Pick<WindowTab, "kind"> & { href?: string; url?: string | undefined },
): string | undefined {
  if (tab.kind === "page") {
    return tab.url && tab.url !== "about:blank" ? tab.url : undefined;
  }
  return tab.href === undefined ? undefined : addressOfHref(tab.href);
}

/** The `instrument://` address of what a screen's href shows, as `instrumentAddressOf` says it. */
export function addressOfHref(
  href: string,
  home: string | undefined = homeDir(),
): string | undefined {
  const screen = matchScreen(href);
  switch (screen.kind) {
    case "computer": {
      if (screen.file !== undefined) {
        return fileAddressOf(expandHomePath(screen.file, home));
      }
      if (screen.root === RECENTS_ROOT || screen.root === COMPUTER_ROOT) {
        return undefined;
      }
      return fileAddressOf(
        expandHomePath(joinHostPath(screen.root, screen.path), home),
        { isFolder: true },
      );
    }
    case "debug":
    case "inbox":
    case "newTab":
    case "site":
    case "unknown": {
      // A built-in page this build's routes do not name yet may still be a
      // screen of the table.
      const name = screenNameOfHref(href);
      return name === undefined ? undefined : screenAddressOf(name);
    }
    default: {
      const linked = instrumentUrlOf(href);
      if (linked !== undefined) {
        return linked;
      }
      const name = screenNameOfHref(href);
      return name === undefined ? undefined : screenAddressOf(name);
    }
  }
}

/** The address of a built-in page by its name in `SCREENS`. */
export function screenAddressOf(name: string): string {
  return `${APP_NAME_SLUG}://screen/${name}`;
}

/**
 * The built-in page a screen's href is at, by its name in `SCREENS`: the
 * page's own href, or a part of it under that href (`/settings/models`).
 */
export function screenNameOfHref(href: string): ScreenName | undefined {
  const pathname = withoutTrailingSlash(new URL(href, "http://tabs").pathname);
  let best: { length: number; name: ScreenName } | undefined;
  for (const [name, screen] of Object.entries(SCREENS)) {
    if (!isScreenName(name) || !("href" in screen)) {
      continue;
    }
    const own = withoutTrailingSlash(screen.href);
    const isAt = pathname === own || pathname.startsWith(`${own}/`);
    if (isAt && own.length > (best?.length ?? -1)) {
      best = { length: own.length, name };
    }
  }
  return best?.name;
}

/**
 * The address of a file or a folder on this computer: its path after
 * `instrument://file`, a folder's ending in a slash. Only what would end the
 * path early in an address is escaped, so the field reads the path as it is.
 */
export function fileAddressOf(
  hostPath: string,
  { isFolder = false }: { isFolder?: boolean } = {},
): string {
  const escaped = hostPath.replaceAll(/[%#?]/g, (character) =>
    encodeURIComponent(character),
  );
  const lead = escaped.startsWith("/") ? "" : "/";
  const tail = isFolder && !escaped.endsWith("/") ? "/" : "";
  return `${APP_NAME_SLUG}://file${lead}${escaped}${tail}`;
}

/** What an address opens: a page, a screen of the app by its href, or a file or folder by its path. */
export type AddressTarget =
  | { href: string; kind: "screen" }
  | { isFolder: boolean; kind: "path"; path: string }
  | { kind: "page"; url: string };

/**
 * What an address opens, or nothing for an `instrument://` address this
 * build does not know. Anything that is not the app's own is a page.
 */
export function targetOfAddress(address: string): AddressTarget | undefined {
  if (!isInstrumentAddress(address)) {
    return { kind: "page", url: address };
  }
  const link = instrumentLinkOf(address);
  if (link) {
    return { href: link.href, kind: "screen" };
  }
  const path = filePathOfInstrumentLink(address);
  if (path === undefined) {
    return undefined;
  }
  const isFolder = path.length > 1 && /[/\\]$/.test(path);
  return { isFolder, kind: "path", path: isFolder ? path.slice(0, -1) : path };
}

/** The screen href a file or folder opens at in Files. */
export function hrefOfPath({
  isFolder,
  path,
}: Extract<AddressTarget, { kind: "path" }>): string {
  return isFolder ? folderHref(path) : fileHref(path);
}

/**
 * Whether two addresses name the same thing: the app's own however a reply
 * spelled it (the scheme of another build, a folder's slash, encoding), and
 * a page's as a browser reads it.
 */
export function sameAddress(a: string, b: string): boolean {
  return a === b || addressKey(a) === addressKey(b);
}

function addressKey(address: string): string {
  if (!URL.canParse(address)) {
    return address;
  }
  if (!isInstrumentAddress(address)) {
    return new URL(address).href;
  }
  const parsed = new URL(address);
  let path = parsed.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Taken as written.
  }
  return `${parsed.host.toLowerCase()}:${withoutTrailingSlash(path)}`;
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** The home folder, which a path from `~` is read against; none outside the app. */
function homeDir(): string | undefined {
  return globalThis.window === undefined ? undefined : window.api?.homeDir;
}
