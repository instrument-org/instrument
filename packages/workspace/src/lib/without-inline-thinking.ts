/**
 * A model's answer without the thinking some models write into the text
 * itself rather than into a reasoning part: every closed think block, and
 * an unclosed one through the end, since then the whole rest was thinking.
 */
export function withoutInlineThinking(text: string): string {
  return text
    .replaceAll(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/g, "")
    .replace(/<think(?:ing)?>[\s\S]*$/, "");
}
