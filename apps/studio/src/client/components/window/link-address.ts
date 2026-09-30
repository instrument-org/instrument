import { fileUrlOf, hostPathOfFileUrl } from "@/client/lib/file-url";
import { instrumentLinkOf } from "@/shared/instrument-link";

/**
 * Where a link's address leads, read the way the window opens things:
 *
 * - `page`: a page on the web, or an address the OS hands to a program
 *   (`mailto:`), which the gestures send where pages go.
 * - `screen`: something inside the app, by the screen that shows it.
 * - `file`: a file or folder on the computer, by its path there. A relative
 *   address is read against the folder of the document it is written in.
 * - `stay`: an address inside the document itself, which the document
 *   scrolls to on its own.
 * - `none`: an address that goes nowhere a click should take anyone: a
 *   script, or a relative address with no document to read it against.
 */
export type LinkTarget =
  | { href: string; kind: "screen" }
  | { kind: "file"; path: string }
  | { kind: "none" }
  | { kind: "page"; url: string }
  | { kind: "stay" };

export function linkTargetOf(
  href: string,
  { base }: { base?: string } = {},
): LinkTarget {
  const address = href.trim();
  if (address === "" || address.startsWith("#")) {
    return { kind: "stay" };
  }
  const link = instrumentLinkOf(address);
  if (link) {
    return { href: link.href, kind: "screen" };
  }
  const scheme = /^([a-z][\d+.a-z-]*):/i.exec(address)?.[1]?.toLowerCase();
  if (scheme === "javascript" || scheme === "data" || scheme === "blob") {
    return { kind: "none" };
  }
  if (scheme === "file") {
    const path = hostPathOfFileUrl(address);
    return path === undefined ? { kind: "none" } : { kind: "file", path };
  }
  if (scheme !== undefined) {
    return { kind: "page", url: address };
  }
  if (base === undefined) {
    return { kind: "none" };
  }
  let resolved: URL;
  try {
    resolved = new URL(address, `${fileUrlOf(base)}/`);
  } catch {
    return { kind: "none" };
  }
  resolved.hash = "";
  resolved.search = "";
  const path = hostPathOfFileUrl(resolved.href);
  return path === undefined ? { kind: "none" } : { kind: "file", path };
}
