import { type RefObject, useEffect, useId, useRef, useState } from "react";

const ACTIVE_MATCH_COLOR = "rgb(234 179 8 / 0.65)";

// Elements whose text is its own run rather than a continuation of what came
// before, so a match may not cross out of one and into the next.
const BLOCK_TAGS = new Set([
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

const MATCH_COLOR = "rgb(234 179 8 / 0.3)";

/**
 * Find-in-document over whatever a viewer has actually rendered.
 *
 * The CSS Custom Highlight API is what makes this viable at all. A notebook's
 * text is spread across rendered markdown, syntax-highlighted code, and
 * sanitized HTML output -- none of it ours to wrap a `<mark>` around without
 * rebuilding those renderers -- and highlights are painted over live `Range`s
 * instead, so the search reads the DOM rather than the model behind it.
 *
 * Ranges are recomputed on any mutation of the container, which is what keeps
 * matches attached while a cell's syntax highlighting arrives from the main
 * process and replaces the plain text standing in for it until then. They are
 * recomputed on a change of its width too: what is searched is what is
 * painted, and a container query can change that without touching the DOM.
 */
export function useFindHighlights({
  containerRef,
  query,
}: {
  containerRef: RefObject<HTMLElement | null>;
  query: string;
}) {
  // The highlight registry is global and keyed by name, so the artifact panel
  // and the expand modal -- which can hold a viewer each, on the same file --
  // would otherwise overwrite each other's matches. `useId` is per instance;
  // the strip is because its value carries delimiters that are not valid in a
  // CSS identifier.
  const instanceId = useId().replaceAll(/[^\da-z]/gi, "");
  const activeName = `notebook-find-active-${instanceId}`;
  const matchName = `notebook-find-${instanceId}`;

  const [ranges, setRanges] = useState<Range[]>([]);
  const [activeMatch, setActiveMatch] = useState(0);
  const scrolledToRef = useRef("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container || query === "") {
      setRanges([]);
      return;
    }

    let frame = 0;
    const update = () => {
      setRanges(findRanges(container, query));
    };

    update();

    // Coalesced to one recompute per frame: syntax highlighting lands cell by
    // cell, and each arrival is its own batch of mutation records.
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    observer.observe(container, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    // A container query decides whether the execution-count gutter is painted,
    // and flipping one mutates nothing, so widening the panel past the
    // threshold would leave every `In [n]:` out of a table that is now wrong
    // about the page -- the readout under the true count, and "next match"
    // walking onto text that is no longer skipped. Narrowing is the same in
    // reverse, and worse: a range in a `display: none` subtree has no box to
    // scroll to, so the view simply does not move. App zoom lands here too,
    // being the other thing that changes what a container query answers.
    let width: number | undefined;
    const resize = new ResizeObserver((entries) => {
      // Only width, and only a change in it: the observer reports once on
      // `observe` -- which the `update()` above has already covered -- and a
      // notebook's height moves constantly as each cell's highlighting
      // arrives. Neither can flip a `@min-width` query, and recomputing on
      // them would double the walk the mutation observer is already coalescing.
      const next = entries[0]?.contentRect.width;
      if (next === undefined || next === width) {
        return;
      }
      const first = width === undefined;
      width = next;
      if (first) {
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    resize.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
    };
  }, [containerRef, query]);

  // A recompute under an unchanged query can return fewer matches than before,
  // so the index is clamped rather than trusted: left alone it points past the
  // end, dropping the highlight and leaving the readout counting past the
  // total.
  const activeIndex =
    ranges.length === 0 ? 0 : Math.min(activeMatch, ranges.length - 1);
  const active = ranges[activeIndex];

  useEffect(() => {
    if (ranges.length === 0) {
      CSS.highlights.delete(matchName);
      CSS.highlights.delete(activeName);
      return;
    }

    // Built by `add` rather than `new Highlight(...ranges)`: the spread passes
    // one argument per match, and a one-character query on a large notebook has
    // enough matches to exceed the engine's argument limit and throw.
    const matches = new Highlight();
    for (const range of ranges) {
      matches.add(range);
    }
    CSS.highlights.set(matchName, matches);

    if (active) {
      CSS.highlights.set(activeName, new Highlight(active));
    }

    return () => {
      CSS.highlights.delete(matchName);
      CSS.highlights.delete(activeName);
    };
  }, [active, activeName, matchName, ranges]);

  useEffect(() => {
    // Recomputing produces fresh `Range` objects for the same matches, so the
    // scroll is keyed on which match is current rather than on that identity.
    // Without it, every cell that finished highlighting would drag the view
    // back to the match under a reader who had scrolled away from it.
    const token = `${query}:${activeIndex}:${ranges.length}`;
    if (token === scrolledToRef.current) {
      return;
    }
    scrolledToRef.current = token;
    // A range has no layout of its own to scroll to, so the element holding
    // its start does the scrolling.
    active?.startContainer.parentElement?.scrollIntoView({
      block: "center",
      inline: "nearest",
    });
  }, [active, activeIndex, query, ranges.length]);

  return {
    activeMatch: activeIndex,
    goToMatch: (delta: number) => {
      if (ranges.length === 0) {
        return;
      }
      const next = (activeIndex + delta) % ranges.length;
      setActiveMatch(next < 0 ? next + ranges.length : next);
    },
    matchCount: ranges.length,
    resetActiveMatch: () => {
      setActiveMatch(0);
    },
    /**
     * The rules for this instance's two highlights, for the viewer to mount in
     * a `<style>`. `::highlight()` takes a registry name rather than a class,
     * so the per-instance names have to reach a stylesheet somehow.
     */
    styleSheet:
      `::highlight(${matchName}) { background-color: ${MATCH_COLOR}; }\n` +
      `::highlight(${activeName}) { background-color: ${ACTIVE_MATCH_COLOR}; }`,
  };
}

/**
 * The nearest ancestor that lays text out as its own block, or the container.
 *
 * Read from tag names rather than computed style: this runs once per text node
 * on every recompute, and asking for style here would flush layout inside the
 * walk rather than once around it.
 */
function blockAncestor(node: Text, container: HTMLElement): Element {
  let element = node.parentElement;
  while (element && element !== container) {
    if (BLOCK_TAGS.has(element.tagName.toLowerCase())) {
      return element;
    }
    element = element.parentElement;
  }
  return container;
}

function clamp(offset: number, node: Text): number {
  return Math.max(0, Math.min(offset, node.length));
}

/**
 * Every occurrence of `query` in the container's rendered text.
 *
 * The text of every node is concatenated first and searched as one string, so a
 * match is found across element boundaries. That is not an edge case here:
 * syntax highlighting wraps each token in its own element, so searching node by
 * node would fail on any query spanning more than one token -- which is most of
 * them, `import os` included.
 */
function findRanges(container: HTMLElement, query: string): Range[] {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let haystack = "";

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let previousBlock: Element | null = null;
  while (node) {
    // Text in a `display: none` subtree still walks, and counting it would put
    // the readout above the number of highlights actually painted and send
    // "next match" to nothing. The gutter is exactly that case: it is hidden
    // below a narrow container, and its `In [n]:` would answer a search for
    // "in". One forced style flush per search is the price, which the
    // per-frame coalescing above keeps to one per frame at worst.
    if (
      node instanceof Text &&
      node.data !== "" &&
      node.parentElement?.checkVisibility() === true
    ) {
      // Concatenating without a separator is what lets a match span the
      // several elements syntax highlighting splits one line into. Across a
      // block boundary it is the opposite: the last character of one cell sits
      // against the first of the next, so a two-letter query can match half in
      // each and paint a highlight over everything between them. A newline
      // between blocks stops that, and cannot be typed into the find field, so
      // no real query can bridge one. It gets no entry in the node table --
      // it belongs to no node -- which is why it is appended before the offset
      // this one starts at is recorded.
      const block = blockAncestor(node, container);
      if (previousBlock !== null && block !== previousBlock) {
        haystack += "\n";
      }
      previousBlock = block;

      nodes.push(node);
      starts.push(haystack.length);
      // Lower-cased per node rather than over the whole string afterwards.
      // Case folding is not length-preserving for every character -- "İ" folds
      // to two code units -- so folding a concatenation built from the original
      // text shifts every offset after the first such character away from the
      // node table, which lands highlights on the wrong words and eventually
      // asks a range for an offset past the end of its node.
      haystack += node.data.toLowerCase();
    }
    node = walker.nextNode();
  }

  const needle = query.toLowerCase();
  const ranges: Range[] = [];

  let from = haystack.indexOf(needle);
  while (from !== -1) {
    const range = toRange({ from, nodes, starts, to: from + needle.length });
    if (range) {
      ranges.push(range);
    }
    from = haystack.indexOf(needle, from + needle.length);
  }

  return ranges;
}

/** The index of the node holding a given offset of the concatenated text. */
function locate(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((starts[middle] ?? 0) <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

function toRange({
  from,
  nodes,
  starts,
  to,
}: {
  from: number;
  nodes: Text[];
  starts: number[];
  to: number;
}): null | Range {
  const startIndex = locate(starts, from);
  // The end offset is exclusive, so the node it lands in is the one holding
  // the last character rather than the one starting at the boundary.
  const endIndex = locate(starts, to - 1);
  const startNode = nodes[startIndex];
  const endNode = nodes[endIndex];
  if (!startNode || !endNode) {
    return null;
  }

  // Clamped because a node whose case folding changed its length leaves the
  // offset inside it a character or two out. A highlight sitting slightly wrong
  // on one of those rare words is a cosmetic miss; an offset past the end of
  // the node is a `DOMException` thrown inside an animation frame, where
  // nothing catches it and every later recompute stops.
  const range = document.createRange();
  range.setStart(startNode, clamp(from - (starts[startIndex] ?? 0), startNode));
  range.setEnd(endNode, clamp(to - (starts[endIndex] ?? 0), endNode));
  return range;
}
