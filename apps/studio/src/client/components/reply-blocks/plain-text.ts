/** A cell's words with the Markdown around them taken off, for labels and matching. */
export const plainTextOf = (markdown: string) =>
  markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|`|~~)(.+?)\1/g, "$2")
    .trim();
