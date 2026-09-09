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
  | { kind: "path"; path: string };

/** What "copy" puts on the clipboard for a target, and what the row is called. */
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
  return undefined;
}

/** Whether a page is one the app can show, as opposed to one the OS resolves to some other program. */
export function isWebPage(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
