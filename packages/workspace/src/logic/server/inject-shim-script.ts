// Ordered anchors for placing the shim as early as the document allows. The
// first three keep it inside (or ahead of) the head the browser will build; the
// doctype anchor exists so we never emit markup before it and trip quirks mode.
const ANCHORS = [
  { pattern: /<head[^>]*>/i, placement: "after" },
  { pattern: /<body[^>]*>/i, placement: "before" },
  { pattern: /<html[^>]*>/i, placement: "after" },
  { pattern: /^\s*<!doctype[^>]*>/i, placement: "after" },
] as const;

/**
 * Insert the shim `<script>` into an HTML document.
 *
 * A literal `<head>` match is not enough: documents are served as `<HEAD>`,
 * `<head lang="en">`, or with no head at all (browsers synthesize one), and a
 * miss means the shim silently never loads -- no console capture, no error
 * overlay, no signal that anything went wrong.
 */
export function injectShimScript(body: string, shimScript: string): string {
  for (const { pattern, placement } of ANCHORS) {
    const match = pattern.exec(body);
    if (!match) {
      continue;
    }
    const at =
      placement === "after" ? match.index + match[0].length : match.index;
    return body.slice(0, at) + shimScript + body.slice(at);
  }

  return shimScript + body;
}
