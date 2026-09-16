// Reduces Markdown to plain text for surfaces that render no formatting, such
// as native notification bodies. This is preview-quality, not a CommonMark
// parser: it drops the common inline and block markers that would otherwise
// show up as literal symbols, and accepts imperfect output on exotic input.
export function stripMarkdown(markdown: string): string {
  let text = markdown;

  // Fenced code blocks: drop the fence lines, keep the code between them.
  text = text.replaceAll(/^\s*(?:```|~~~)[^\n]*$/gm, "");

  // Images: drop them; their alt text rarely reads well inline.
  text = text.replaceAll(/!\[[^\]]*\]\([^)]*\)/g, "");

  // Links: keep the visible text, drop the target.
  text = text.replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replaceAll(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");

  // Leading block markers: ATX headings, blockquotes, list bullets.
  text = text.replaceAll(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replaceAll(/^\s{0,3}>\s?/gm, "");
  text = text.replaceAll(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, "");
  text = text.replaceAll(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, "");

  // Emphasis and strikethrough. Run the asterisk/tilde pass twice for nesting.
  text = text.replaceAll(/(\*{1,3}|~~)(?!\s)(.+?)(?<!\s)\1/g, "$2");
  text = text.replaceAll(/(\*{1,3}|~~)(?!\s)(.+?)(?<!\s)\1/g, "$2");
  // Underscores only when not inside a word, to spare snake_case identifiers.
  text = text.replaceAll(/\b(_{1,3})(?!\s)(.+?)(?<!\s)\1\b/g, "$2");

  // Inline code.
  text = text.replaceAll(/`+([^`]+)`+/g, "$1");

  return text;
}
