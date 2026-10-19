import { type ChatId } from "@instrument-org/workspace/client";
import {
  filePathOfInstrumentLink,
  instrumentLinkOf,
  instrumentUrlOf,
} from "@/shared/instrument-link";

/**
 * Something in the app that a click can open, named the way the surface
 * drawing it already knows it.
 *
 * The one vocabulary every openable thing is described in, so the question
 * "what happens when this is clicked" has one answer rather than one per
 * component. A link in a reply, a file card under it, a row in Recent files, a
 * door on the new tab page and a task card are all one of these, and the
 * gestures over them are bound once against this rather than written again on
 * each `<button>`.
 */
export type OpenTarget =
  /** A screen of the app, by the route that shows it. */
  | { href: string; kind: "screen" }
  /** A web page. */
  | { kind: "page"; url: string }
  /** A file or a folder, by the path the conversation reaches it through. A trailing slash names a folder. */
  | {
      /**
       * The chat the path was kept by, when the surface drawing it knows:
       * "Copy Path" then copies where the file is on this computer, read
       * against that chat, rather than the chat's own spelling of it
       * (`workspace:/Notes/plan.md`, `attachments/cat.png`).
       */
      chatId?: ChatId;
      kind: "path";
      path: string;
    };

/**
 * What "copy" puts on the clipboard for a target, and what the row is called.
 *
 * A screen copies as the app's own address for the thing on it, which is the
 * same address a reply links it by, so a chat or a task can be pasted
 * anywhere a link can and comes back here. A screen no address names copies
 * as nothing.
 */
export function copyableOf(target: OpenTarget):
  | undefined
  | {
      label: string;
      value: string;
    } {
  if (target.kind === "page") {
    return { label: "Copy Link", value: target.url };
  }
  if (target.kind === "path") {
    return { label: "Copy Path", value: target.path };
  }
  const url = instrumentUrlOf(target.href);
  return url ? { label: "Copy Link", value: url } : undefined;
}

/** Whether a page is one the app can show, as opposed to one the OS resolves to some other program. */
export function isWebPage(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * What a link written in a document names, read from its `href` as written:
 * a screen for an address into the app, a path for a file (an `instrument://file/`
 * address, a `file:` URL, or, given the document's `folder`, a path relative
 * to it), and a page for anything else. Undefined for no address and for a
 * place in the document itself, which the surface showing it scrolls to.
 */
export function openTargetOfHref(
  href: string,
  folder?: string,
): OpenTarget | undefined {
  if (!href || href.startsWith("#")) {
    return undefined;
  }
  const link = instrumentLinkOf(href);
  if (link) {
    return { href: link.href, kind: "screen" };
  }
  const filePath = filePathOfInstrumentLink(href);
  if (filePath !== undefined) {
    return { kind: "path", path: filePath };
  }
  const path = hostPathOfHref(href, folder);
  return path === undefined
    ? { kind: "page", url: href }
    : { kind: "path", path };
}

/**
 * The path on this computer a `file:` URL names, or, given a folder, a link
 * relative to it, as any Markdown app reads one.
 */
function hostPathOfHref(href: string, folder?: string): string | undefined {
  if (href.startsWith("//")) {
    return undefined;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  // A Windows path's drive letter reads as a scheme of one letter.
  const relative = !scheme || scheme.length === 1;
  if (scheme !== "file" && !(relative && folder !== undefined)) {
    return undefined;
  }
  try {
    const url =
      scheme === "file"
        ? new URL(href)
        : new URL(
            href,
            `file://${encodeURI((folder ?? "").replaceAll("\\", "/"))}`,
          );
    return decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
}
