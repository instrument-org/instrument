import { type WindowTab } from "@/client/atoms/window";
import { joinHostPath } from "@/client/components/window/host-path";
import { fileUrlOf, hostPathOfFileUrl } from "@/client/lib/file-url";
import { matchScreen } from "@/client/components/window/window-href";
import {
  COMPUTER_ROOT,
  fileHref,
  folderHref,
  RECENTS_ROOT,
} from "@/shared/computer-href";
import { instrumentAddressOf } from "@/shared/instrument-screens";
import {
  expandHomePath,
  filePathOfInstrumentLink,
  instrumentLinkOf,
  isInstrumentAddress,
} from "@instrument-org/shared";

/**
 * A tab's address, the one thing a bookmark keeps and a link names, the
 * truest one it has: a page's own, a file's or a folder's `file://` address
 * (the one the field shows and copies for a file), and for anything else the
 * app shows, which has no other, the address `instrumentAddressOf` gives it (`instrument://chat/<id>`,
 * `instrument://screen/<name>`, `instrument://settings/<part>`). Nothing for
 * a tab with nothing to keep: a new tab, a new chat, the recents.
 */
export function addressOfTab(
  tab: Pick<WindowTab, "kind"> & { href?: string; url?: string | undefined },
  home: string | undefined = homeDir(),
): string | undefined {
  if (tab.kind === "page") {
    return tab.url && tab.url !== "about:blank" ? tab.url : undefined;
  }
  if (tab.href === undefined) {
    return undefined;
  }
  const screen = matchScreen(tab.href);
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
    case "site":
    case "unknown": {
      return undefined;
    }
    default: {
      return instrumentAddressOf(tab.href);
    }
  }
}

/**
 * The address of a file or a folder on this computer: its `file://` address,
 * the one a browser opens it at (`fileUrlOf`), a folder's ending in a slash.
 */
export function fileAddressOf(
  hostPath: string,
  { isFolder = false }: { isFolder?: boolean } = {},
): string {
  const url = fileUrlOf(hostPath);
  return isFolder && !url.endsWith("/") ? `${url}/` : url;
}

/** What an address opens: a page, a screen of the app by its href, or a file or folder by its path. */
export type AddressTarget =
  | { href: string; kind: "screen" }
  | { isFolder: boolean; kind: "path"; path: string }
  | { kind: "page"; url: string };

/**
 * What an address opens, or nothing for an `instrument://` address this
 * build does not know. A `file://` address names a file or a folder, as the
 * address field reads one typed there, and so does the
 * `instrument://file/<path>` an earlier build kept; a `file://` address to a
 * place in a page (`?frame=2`, `#part`) is a page, since only the page
 * reaches it. Anything else that is not the app's own is a page.
 */
export function targetOfAddress(address: string): AddressTarget | undefined {
  if (/^file:/i.test(address)) {
    return isPlaceInPage(address)
      ? { kind: "page", url: address }
      : pathTarget(hostPathOfFileUrl(address));
  }
  if (!isInstrumentAddress(address)) {
    return { kind: "page", url: address };
  }
  const link = instrumentLinkOf(address);
  if (link) {
    return { href: link.href, kind: "screen" };
  }
  return pathTarget(filePathOfInstrumentLink(address));
}

/** A path as an address names it, a folder's by the separator after it. */
function pathTarget(path: string | undefined): AddressTarget | undefined {
  if (path === undefined || path === "") {
    return undefined;
  }
  const isFolder = path.length > 1 && /[/\\]$/.test(path);
  return { isFolder, kind: "path", path: isFolder ? path.slice(0, -1) : path };
}

/** Whether a `file://` address names a place in its page, by a query or a fragment. */
function isPlaceInPage(address: string): boolean {
  if (!URL.canParse(address)) {
    return false;
  }
  const url = new URL(address);
  return url.search !== "" || url.hash !== "";
}

/** The screen href a file or folder opens at in Files. */
export function hrefOfPath({
  isFolder,
  path,
}: Extract<AddressTarget, { kind: "path" }>): string {
  return isFolder ? folderHref(path) : fileHref(path);
}

>>>NEW

/**
 * The paths of the files and folders kept as bookmarks, as `sameAddress`
 * reads each address: a folder's without its separator. A view of many
 * files marks the kept ones by these rather than reading every bookmark for
 * each row.
 */
export function keptPaths(bookmarks: readonly { url: string }[]): Set<string> {
  return new Set(
    bookmarks.flatMap((bookmark) => {
      const target = targetOfAddress(bookmark.url);
      return target?.kind === "path" ? [target.path] : [];
    }),
  );
}

/**
 * Whether two addresses name the same thing: a file or a folder by its path
 * however it is spelled (`file://` or the `instrument://file` an earlier
 * build kept, a folder's slash, encoding), the app's own however a reply
 * spelled it (the scheme of another build), and a page's as a browser reads
 * it.
 */
export function sameAddress(a: string, b: string): boolean {
  return a === b || addressKey(a) === addressKey(b);
}

function addressKey(address: string): string {
  const target = targetOfAddress(address);
  if (target?.kind === "path") {
    return `path:${target.path}`;
  }
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
