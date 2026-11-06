/**
 * Wraps each word of rendered markdown in a span the stylesheet fades in.
 *
 * The animation is not driven from here and needs no state: a span animates
 * because it just mounted, and React only mounts the spans holding words that
 * were not in the previous parse. Words already on screen keep their position
 * in the parent's child list, so they keep their identity and sit still.
 *
 * That is also why the split is per word and not per arriving delta. Delta size
 * is the provider's business and runs from one token to forty, and a span per
 * delta makes a large one animate as a single slab.
 *
 * Whitespace stays outside the spans, as the plain text nodes it already was,
 * so line breaking is exactly what it would have been without the split. The
 * spans themselves stay inline and the stylesheet animates only their opacity,
 * which means a word occupies its final box from the first frame and never
 * nudges the words already beside it. Anything that moved the text as it
 * arrived (a transform, `display: inline-block`, an animated width) would fight
 * the reflow that appending to a paragraph already causes.
 */

// Text inside these is either not prose or is about to be parsed by something
// that needs it whole: `code` and `pre` reach components that read their
// children as a string, and the math elements are what KaTeX consumes.
const OPAQUE_TAGS = new Set([
  "annotation",
  "code",
  "math",
  "pre",
  "script",
  "style",
  "svg",
]);

// `@types/hast` is not a dependency here, and this reads three fields, so it
// describes the nodes structurally rather than pulling the tree's full types in.
interface HastNode {
  children?: HastNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type: string;
  value?: string;
}

/**
 * Runs last in the rehype chain, so that everything working from the text of a
 * node -- raw HTML re-parsed by `rehype-raw`, formulas read by `rehype-katex`
 * -- has already had it whole.
 */
export function rehypeAnimateWords() {
  return (tree: HastNode): void => {
    animateChildren(tree);
  };
}

function animateChildren(node: HastNode): void {
  if (!node.children) {
    return;
  }

  const next: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      next.push(...splitIntoWords(child.value ?? ""));
      continue;
    }
    if (child.type === "element" && !OPAQUE_TAGS.has(child.tagName ?? "")) {
      animateChildren(child);
    }
    next.push(child);
  }
  node.children = next;
}

function splitIntoWords(value: string): HastNode[] {
  const nodes: HastNode[] = [];
  for (const piece of value.split(/(\s+)/)) {
    if (piece === "") {
      continue;
    }
    nodes.push(
      /^\s+$/.test(piece)
        ? { type: "text", value: piece }
        : {
            children: [{ type: "text", value: piece }],
            properties: { dataStreamWord: "" },
            tagName: "span",
            type: "element",
          },
    );
  }
  return nodes;
}
