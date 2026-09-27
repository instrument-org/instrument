/**
 * A page in Edit is loaded at its own `file://` address with this query
 * parameter added, whose value is the one load it belongs to. The main process
 * serves the stamped copy for exactly that address and the file from disk for
 * every other, so the page keeps its real address, origin and folder while it
 * is being edited. Nobody else should see the parameter: the address bar, Copy
 * URL, the way out to another browser, and the agent all get the address
 * without it.
 */
export const PAGE_EDIT_PARAM = "instrument-edit";

const LEADING = new RegExp(`\\?${PAGE_EDIT_PARAM}=[^&#\\s"'<>)]*&`, "g");
const ANYWHERE = new RegExp(`[?&]${PAGE_EDIT_PARAM}=[^&#\\s"'<>)]*`, "g");
const PRESENT = new RegExp(`[?&]${PAGE_EDIT_PARAM}=`);

/** Whether an address is a page's stamped copy in Edit. */
export function isPageEditAddress(url: string): boolean {
  return PRESENT.test(url);
}

/** Text or an address with every Edit parameter taken out, and the rest of each query kept. */
export function withoutPageEditParam(text: string): string {
  return text.replaceAll(LEADING, "?").replaceAll(ANYWHERE, "");
}
