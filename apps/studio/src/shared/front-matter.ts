// A Markdown file's front matter as the app reads it, wherever the file is
// drawn: the editor, the viewer's properties panel, and a file's thumbnail.

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
