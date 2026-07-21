/**
 * The serialized form of a skill mention, shared by the composer and the
 * transcript. The composer writes it on submit; the transcript reads it back so
 * a sent message shows the same token the user typed rather than its wire form.
 */
const skillTokenPattern = /\[\$([^\]]+)\]\(skill:([^)]+)\)/g;

export type SkillTokenSegment =
  | { name: string; type: "skill" }
  | { text: string; type: "text" };

/**
 * Color alone marks the token, in the composer and the transcript alike. In the
 * composer it also has to stay out of the text flow's way, which is what lets
 * the caret sit beside it.
 */
export const SKILL_TOKEN_CLASS_NAME =
  "font-medium text-brown-700 dark:text-brown-500";

/** How a skill mention reads to a person, in the composer and the transcript alike. */
export function skillTokenLabel(name: string) {
  return `/${name}`;
}

/** The message as it reads on screen, for copying and for plain-text contexts. */
export function skillTokensToDisplayText(value: string) {
  return value
    .split("\n")
    .map((line) =>
      splitSkillTokens(line)
        .map((segment) =>
          segment.type === "skill"
            ? skillTokenLabel(segment.name)
            : segment.text,
        )
        .join(""),
    )
    .join("\n");
}

/**
 * Split a line into literal text and skill mentions.
 *
 * A link whose label and target disagree is not something the composer can
 * have produced, so it stays literal text rather than being rewritten into a
 * token the user never wrote.
 */
export function splitSkillTokens(line: string): SkillTokenSegment[] {
  const segments: SkillTokenSegment[] = [];
  let cursor = 0;

  for (const match of line.matchAll(skillTokenPattern)) {
    const index = match.index;
    const label = match[1];
    const name = match[2];
    if (!label || !name || label !== name) {
      continue;
    }
    if (index > cursor) {
      segments.push({ text: line.slice(cursor, index), type: "text" });
    }
    segments.push({ name, type: "skill" });
    cursor = index + match[0].length;
  }

  if (cursor < line.length) {
    segments.push({ text: line.slice(cursor), type: "text" });
  }

  return segments;
}
