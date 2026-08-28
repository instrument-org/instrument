// cspell:ignore dataframe
import { createElement, Fragment, type ReactNode } from "react";

import { ExternalLink } from "../external-link";

/**
 * An HTML output bundle, rendered as elements this app controls.
 *
 * `text/html` is how the most useful outputs in a notebook arrive -- a pandas
 * DataFrame is a table, and most rich reprs are markup -- so dropping the
 * bundle would throw away the part of a notebook people open it for. It is also
 * arbitrary markup from an untrusted file, so none of it reaches the page as
 * HTML: the document is parsed inert with `DOMParser`, walked against the
 * allow-lists below, and rebuilt as React elements.
 *
 * ## Why not the sandboxed iframe
 *
 * The other option was `SandboxedHtmlIframe`, which the HTML file type uses,
 * and it looks like the stronger one because scripts could run inside an opaque
 * origin -- which is what an interactive plot needs. They cannot. A frame
 * loaded from `data:`, `blob:`, or `srcdoc` inherits the embedder's CSP, and
 * this renderer's `script-src` is `'self' 'wasm-unsafe-eval'`, so every inline
 * script in that frame is blocked exactly as it is here. The iframe would buy
 * no script execution, and would cost the three things sanitizing keeps:
 *
 * - Find. Output inside a cross-origin frame is invisible to the viewer's find
 *   and to the browser's.
 * - Theme. A frame renders on its own white page at every app theme.
 * - Height. With no same-origin access there is nothing to measure the frame
 *   against, so a two-row DataFrame gets whatever fixed height we guessed.
 *
 * So: sanitize, and accept that a script-driven interactive figure degrades.
 * It degrades to something rather than nothing -- an output carrying a picture
 * alongside its markup renders the picture, which is why the parser's mime
 * precedence ranks images above HTML, and one carrying neither falls back to
 * its `text/plain` repr.
 *
 * ## What is dropped, and why
 *
 * - `class` and `style`, on every element. This app is styled by Tailwind class
 *   names, so markup from a file that could name them is markup that could
 *   paint itself over the app: `class="fixed inset-0 z-50"` is a full-window
 *   overlay. The cost is that a pandas `Styler` gradient renders as a plain
 *   table -- presentation is ours, the data is the file's.
 * - `<style>` and `<script>`, subtree and all. The `.dataframe` rules pandas
 *   ships are cosmetic, and the table reads correctly without them.
 * - Inline `<svg>`, which carries its own scripts and event handlers and would
 *   need a second allow-list. Vector output reaches the viewer through the
 *   `image/svg+xml` bundle instead, where it is served to an `<img>` and cannot
 *   run anything.
 * - Remote image sources. An `<img src="https://…/pixel.png?id=…">` needs no
 *   script to phone home: opening the file is the request, which discloses an
 *   IP and confirms the read, and inside a desktop app it can also probe hosts
 *   only this machine can reach. The renderer's `img-src` already blocks most
 *   of the web, but it permits a few content hosts that anyone can upload to,
 *   which is enough for a tracking pixel. Notebook images arrive base64-encoded
 *   in the mime bundle, so `data:` costs the common case nothing.
 */
export function NotebookHtml({ html }: { html: string }) {
  const parsed = new DOMParser().parseFromString(html, "text/html");

  return (
    <div className="max-w-full overflow-x-auto">
      <div className="prose prose-custom text-sm/relaxed wrap-break-word dark:prose-invert prose-table:text-sm">
        {toReactChildren(parsed.body, 0)}
      </div>
    </div>
  );
}

// Tags rendered with no attributes at all. The four that do carry one -- the
// cells and the anchor and image -- are handled on their own below, which is
// what keeps this from needing an attribute allow-list as well.
const ALLOWED_TAGS = new Set([
  "b",
  "blockquote",
  "br",
  "caption",
  "code",
  "dd",
  "del",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "tr",
  "u",
  "ul",
]);

// Dropped along with everything inside them, rather than unwrapped: their
// contents are code, styling, or a nested browsing context rather than text the
// reader was meant to see.
const DROPPED_TAGS = new Set([
  "audio",
  "button",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "math",
  "meta",
  "noscript",
  "object",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "video",
]);

const IMAGE_SCHEMES = ["data:image/"];

// A link is only followed when someone clicks it, and it opens in the real
// browser rather than here, so remote schemes stay allowed for anchors even
// though they are not for images.
const LINK_SCHEMES = ["http://", "https://", "mailto:"];

// Deep enough that no markup a library emits comes near it -- a DataFrame nests
// about six levels -- and shallow enough that a file nesting `<div>` thousands
// of times to overflow the stack is cut off instead.
const MAX_DEPTH = 100;

// The elements whose only legal children are other table parts, so a
// whitespace-only text node between them is formatting rather than content.
const TABLE_CONTAINER_TAGS = new Set([
  "colgroup",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "tr",
]);

const VOID_TAGS = new Set(["br", "hr"]);

function readNumber(element: Element, name: string): number | undefined {
  const value = Number.parseInt(element.getAttribute(name) ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** A URL, if it uses one of the schemes this element is allowed to reach. */
function readUrl(value: null | string, schemes: string[]): string | undefined {
  if (value === null) {
    return undefined;
  }
  const url = value.trim();
  const lowered = url.toLowerCase();
  return schemes.some((scheme) => lowered.startsWith(scheme)) ? url : undefined;
}

function toReact(node: Node, key: number, depth: number): ReactNode {
  if (node instanceof Text) {
    // The newlines a table's markup is formatted with survive parsing as text
    // nodes directly inside `<table>` and `<tbody>`, where the HTML parser is
    // required to keep them. Handing them back to React as children of those
    // elements makes it log a DOM-nesting error for each one, so a DataFrame
    // with many rows fills the console with them. The browser's own parser is
    // what dropped these when the markup was rendered as HTML; rebuilding the
    // tree element by element is what brings them back.
    if (
      node.data.trim() === "" &&
      TABLE_CONTAINER_TAGS.has(node.parentElement?.tagName.toLowerCase() ?? "")
    ) {
      return null;
    }
    return node.data;
  }

  if (!(node instanceof Element)) {
    return null;
  }

  const tag = node.tagName.toLowerCase();
  if (DROPPED_TAGS.has(tag)) {
    return null;
  }

  if (tag === "img") {
    const src = readUrl(node.getAttribute("src"), IMAGE_SCHEMES);
    return src === undefined ? null : (
      <img
        alt={node.getAttribute("alt") ?? ""}
        className="max-w-full"
        key={key}
        src={src}
      />
    );
  }

  const children = toReactChildren(node, depth);

  if (tag === "td") {
    return (
      <td
        colSpan={readNumber(node, "colspan")}
        key={key}
        rowSpan={readNumber(node, "rowspan")}
      >
        {children}
      </td>
    );
  }

  if (tag === "th") {
    return (
      <th
        colSpan={readNumber(node, "colspan")}
        key={key}
        rowSpan={readNumber(node, "rowspan")}
      >
        {children}
      </th>
    );
  }

  if (tag === "a") {
    const href = readUrl(node.getAttribute("href"), LINK_SCHEMES);
    // A link we will not follow still had text in it, so the element goes and
    // the words stay.
    return href === undefined ? (
      <Fragment key={key}>{children}</Fragment>
    ) : (
      <ExternalLink addReferral={false} href={href} key={key}>
        {children}
      </ExternalLink>
    );
  }

  // An unlisted tag is unwrapped rather than dropped: it is usually a wrapper
  // this allow-list has not heard of, and its text is still output.
  if (!ALLOWED_TAGS.has(tag)) {
    return <Fragment key={key}>{children}</Fragment>;
  }

  const props = { key: String(key) };
  return VOID_TAGS.has(tag)
    ? createElement(tag, props)
    : createElement(tag, props, children);
}

function toReactChildren(node: Node, depth: number): ReactNode[] {
  if (depth >= MAX_DEPTH) {
    return [];
  }
  return [...node.childNodes].map((child, index) =>
    toReact(child, index, depth + 1),
  );
}
