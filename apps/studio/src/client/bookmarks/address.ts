import { type WindowTab } from "@/client/atoms/window";
import { joinHostPath } from "@/client/components/window/host-path";
import { matchScreen } from "@/client/components/window/window-href";
import {
  COMPUTER_ROOT,
  fileHref,
  folderHref,
  RECENTS_ROOT,
} from "@/shared/computer-href";
import { instrumentAddressOf } from "@/shared/instrument-screens";
import {
  APP_NAME_SLUG,
  expandHomePath,
  filePathOfInstrumentLink,
  instrumentLinkOf,
  isInstrumentAddress,
} from "@instrument-org/shared";

/**
 * A tab's address, the one thing the field shows while it has the caret, a
 * bookmark keeps and a link names: a page's own, a file's or a folder's
 * path (`instrument://file/<path>`), and for anything else the app shows the
 * address `instrumentAddressOf` gives it (`instrument://chat/<id>`,
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
