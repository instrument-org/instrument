// A ceiling, not a target. Short titles are the failure mode this backs off
// from: at five words the only way to fit was to drop the distinguishing
// detail, and a list of "Wikipedia link navigation" and "Documents folder
// contents" tells the reader nothing about which one theirs was. The sidebar is
// 250px, so a title much past this truncates on sight rather than in memory.
export const MAX_TITLE_WORDS = 8;

/**
 * The opening words of a line, held to a title's length, that stand for a
 * chat until it is named: a whole first paragraph in a title's place spreads
 * across the head and every list the chat is in.
 */
export function placeholderTitle(line: string): string {
  const words = line.trim().split(/\s+/u).filter(Boolean);
  return words.length > MAX_TITLE_WORDS
    ? `${words.slice(0, MAX_TITLE_WORDS).join(" ")}…`
    : words.join(" ");
}
