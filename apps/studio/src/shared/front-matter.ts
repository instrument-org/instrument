// A Markdown file's front matter as the app reads it, wherever the file is
// drawn: the editor, the viewer's properties panel, and a file's thumbnail.

/** Front matter at the very top of a file, fences and all. */
const FRONT_MATTER =
  /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** The keys whose value names a document, in the order files tend to use. */
const TITLE_KEYS = ["title", "name", "taskName", "sessionTitle"];

/** Whether parsed front matter is a mapping, the one shape drawn as properties. */
export const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The value under the first `title`-shaped key that holds text, if any does. */
export function frontMatterTitle(properties: Record<string, unknown>) {
  return TITLE_KEYS.map((key) => properties[key]).find(
    (value): value is string =>
      typeof value === "string" && value.trim() !== "",
  );
}

/** A file's text as its front matter (empty when it has none) and the body after it. */
export function splitFrontMatter(text: string): { body: string; fm: string } {
  const m = FRONT_MATTER.exec(text);
  return m
    ? { body: text.slice(m[0].length), fm: m[0] }
    : { body: text, fm: "" };
}
