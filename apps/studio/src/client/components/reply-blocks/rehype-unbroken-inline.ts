/**
 * The longest label, in characters, that a chip or a code span keeps to one
 * line. Most files' names and documents' titles fit under it, and fit a
 * narrow reply's line whole.
 */
export const UNBROKEN_LABEL_MAX = 36;

// `@types/hast` is not a dependency here; this reads a handful of fields.
interface HastNode {
  children?: HastNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type: string;
  value?: string;
}

const textOf = (node: HastNode): string =>
  node.type === "text"
    ? (node.value ?? "")
    : (node.children ?? []).map(textOf).join("");

// A bracket or quote that opens what follows it.
const OPENING_MARK = /[([{"'“‘«]$/u;

/**
 * Keeps short inline runs whole across line ends:
 *
 * - a code span up to `UNBROKEN_LABEL_MAX` characters stays on one line, so
 *   a name like `fern-street-bakery.csv` never breaks at a hyphen; a longer
 *   one wraps, each piece in its own frame;
 * - an opening bracket or quote written against a link stays on the link's
 *   line. A chip or a page link starts with an icon, and a line may end
 *   before an icon wherever it sits, which left `(` alone at the end of the
 *   line above the chip it opened. The mark and the link share a span that
 *   does not wrap, and the link inside it wraps as it would anywhere.
 */
export function rehypeUnbrokenInline() {
  return (tree: HastNode) => {
    visit(tree);
  };
}

function visit(node: HastNode) {
  const children = node.children;
  if (!children || (node.type === "element" && node.tagName === "pre")) {
    return;
  }
  for (const child of children) {
    if (
      child.type === "element" &&
      child.tagName === "code" &&
      textOf(child).length <= UNBROKEN_LABEL_MAX
    ) {
      child.properties = { ...child.properties, dataUnbroken: "" };
    }
    visit(child);
  }
  for (let index = 1; index < children.length; index += 1) {
    const link = children[index];
    const before = children[index - 1];
    const mark =
      before?.type === "text"
        ? OPENING_MARK.exec(before.value ?? "")?.[0]
        : undefined;
    if (
      link?.type !== "element" ||
      link.tagName !== "a" ||
      before === undefined ||
      mark === undefined
    ) {
      continue;
    }
    const text = before.value ?? "";
    before.value = text.slice(0, text.length - mark.length);
    children[index] = {
      children: [{ type: "text", value: mark }, link],
      properties: { dataUnbroken: "" },
      tagName: "span",
      type: "element",
    };
  }
}
