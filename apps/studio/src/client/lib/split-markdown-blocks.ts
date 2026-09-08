import { Lexer, type Token } from "marked";

/**
 * Splits markdown into blocks that each parse correctly on their own.
 *
 * A reply that is still arriving is re-parsed on every chunk, and the parser
 * starts from the beginning each time, so the cost of one turn grows with the
 * square of the reply. Markdown's block structure is what makes that
 * avoidable: a block closes at a blank line and nothing later in the document
 * reopens it, so of a message that just grew by a few bytes exactly one block
 * can have changed. Split it, and the renderer re-parses that one.
 *
 * The split is taken by a second, much cheaper parser -- a lexer being asked
 * where the blank lines are, not to agree with the real one about anything
 * subtle. Two rules keep it honest. It may lex and must never parse: the walk a
 * parse performs over its tokens is quadratic, and a no-op one costs a 2 MB
 * document twenty times what lexing it does. And it must never register an
 * extension, which is what turns that walk on.
 *
 * Nothing here is allowed to change what a document renders as. Where a block
 * cannot stand alone the whole document comes back as one block, which is
 * slower and always correct; see `standsAlone`.
 */

// A reference and its definition have to meet in one parse, and the definition
// conventionally sits at the foot of the document, blocks away from the
// reference that needs it. Split, and both render as the literal text someone
// typed.
//
// The identifier is bounded rather than greedy so that prose carrying a
// bracketed expression is not read as a definition, and so the pattern cannot
// walk the whole document from every `[`.
const FOOTNOTE_REFERENCE = /\[\^[\w-]{1,200}\](?!:)/;
const FOOTNOTE_DEFINITION = /\[\^[\w-]{1,200}\]:/;

// `[label]: https://…`, the same problem: the link that uses the label is in an
// earlier block than the line that gives it a destination. Up to three spaces
// of indent is what the markdown spec allows before one.
const LINK_REFERENCE_DEFINITION = /^ {0,3}\[[^\]\n]{1,200}\]:/m;

/**
 * Whether every block in this document can be parsed without the others.
 *
 * The exceptions are the constructs that resolve a name written in one place
 * against a definition written in another. Both are rare in a model's prose and
 * rarer in the long prose this is for, and the cost of being wrong the safe way
 * is one document that parses as it always did.
 *
 * A fenced code block holding a line that looks like a definition sends a
 * document down this path too. That is the harmless direction, and cheaper to
 * accept than a fence-aware scan.
 */
const standsAlone = (markdown: string) =>
  !FOOTNOTE_REFERENCE.test(markdown) &&
  !FOOTNOTE_DEFINITION.test(markdown) &&
  !LINK_REFERENCE_DEFINITION.test(markdown);

// Tags that carry no closing tag, so an unbalanced count of them means nothing.
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// One pattern per tag name, built once. A document of many `<details>` asks for
// the same two patterns on every block.
const openPatterns = new Map<string, RegExp>();
const closePatterns = new Map<string, RegExp>();

const openPattern = (tag: string) => {
  const existing = openPatterns.get(tag);
  if (existing) {
    return existing;
  }
  const pattern = new RegExp(`<${tag}(?=[\\s>/])[^>]*>`, "gi");
  openPatterns.set(tag, pattern);
  return pattern;
};

const closePattern = (tag: string) => {
  const existing = closePatterns.get(tag);
  if (existing) {
    return existing;
  }
  const pattern = new RegExp(`</${tag}(?=[\\s>])[^>]*>`, "gi");
  closePatterns.set(tag, pattern);
  return pattern;
};

// Openings that are still waiting for a close. A tag written `<div />` closes
// itself and is not one of them.
const countOpenings = (block: string, tag: string) => {
  if (VOID_ELEMENTS.has(tag)) {
    return 0;
  }
  const found = block.match(openPattern(tag)) ?? [];
  return found.filter((match) => !match.trimEnd().endsWith("/>")).length;
};

const countClosings = (block: string, tag: string) =>
  (block.match(closePattern(tag)) ?? []).length;

// The tag a run of raw HTML opens, which is the one the run has to close before
// the block can end. Hyphens and colons are in the name so a custom element is
// tracked like any other.
const OPENING_TAG = /<([A-Za-z][\w:-]*)[\s>/]/;

// A `$$` display formula is not a block construct the lexer knows, so a
// formula whose body happens to look like one -- a line of `=`, most often --
// arrives as several tokens. An odd count of `$$` in what came before means the
// formula is still open and the next token belongs to it.
const countDisplayMathMarkers = (block: string) => {
  let count = 0;
  for (let index = 0; index < block.length - 1; index += 1) {
    if (block[index] === "$" && block[index + 1] === "$") {
      count += 1;
      index += 1;
    }
  }
  return count;
};

/**
 * The source of each block, in order, such that joining them reproduces the
 * input exactly.
 */
export function splitMarkdownBlocks(markdown: string): string[] {
  if (!markdown) {
    return [];
  }
  if (!standsAlone(markdown)) {
    return [markdown];
  }

  const blocks: string[] = [];
  // The raw HTML tags still open, innermost last. While any are, every token
  // belongs to the block that opened them: an element opened in one block
  // cannot wrap content in another, because each block becomes its own subtree.
  const openTags: string[] = [];
  let afterCodeFence = false;

  const appendToLast = (raw: string) => {
    blocks[blocks.length - 1] += raw;
  };

  for (const token of Lexer.lex(markdown, { gfm: true }) as Token[]) {
    const raw = token.raw;

    if (openTags.length > 0 && blocks.length > 0) {
      appendToLast(raw);
      // Counted against the innermost open tag alone, so that a nested one of
      // the same name closing does not end the outer element early.
      const tag = openTags.at(-1) as string;
      for (let index = 0; index < countOpenings(raw, tag); index += 1) {
        openTags.push(tag);
      }
      for (let index = 0; index < countClosings(raw, tag); index += 1) {
        if (openTags.at(-1) === tag) {
          openTags.pop();
        }
      }
      continue;
    }

    if (token.type === "html" && token.block === true) {
      const tag = OPENING_TAG.exec(raw)?.[1]?.toLowerCase();
      if (tag) {
        // One entry per opening left unclosed, not one for the run. A block
        // that opens `<div><div>` and closes neither is two deep, and pushing
        // once lets the first `</div>` to arrive end the block with the outer
        // element still open -- which drops everything after it out of that
        // element.
        const unclosed = countOpenings(raw, tag) - countClosings(raw, tag);
        for (let index = 0; index < unclosed; index += 1) {
          openTags.push(tag);
        }
      }
    }

    // The blank lines after a block arrive as a token of their own rather than
    // inside the block they follow. They are never content, and folding them
    // back is what keeps the blocks joinable into the original.
    if (token.type === "space" && blocks.length > 0) {
      appendToLast(raw);
      continue;
    }

    if (blocks.length > 0 && !afterCodeFence) {
      const previous = blocks[blocks.length - 1] as string;
      if (countDisplayMathMarkers(previous) % 2 === 1) {
        appendToLast(raw);
        continue;
      }
    }

    blocks.push(raw);

    // A fence is exempt from the check above, since `$$` inside one is shell
    // syntax rather than a formula. Whitespace says nothing either way.
    if (token.type !== "space") {
      afterCodeFence = token.type === "code";
    }
  }

  return blocks;
}
