// The one definition of the skill-mention wire form, shared by every side that
// reads or writes it: the composer that serializes a chip, the transcript that
// renders it back, and the workspace that hands the message to the model. The
// composer writes `[$name](skill:name)`; a person sees `/name`.
const SKILL_MENTION_PATTERN = /\[\$([^\]]+)\]\(skill:([^)]+)\)/g;

export type SkillMentionSegment =
  | { name: string; type: "skill" }
  | { text: string; type: "text" };

/** The distinct skill names a text refers to, in first-seen order. */
export function extractSkillMentions(text: string) {
  return [
    ...new Set(
      [...text.matchAll(SKILL_MENTION_PATTERN)].flatMap((match) =>
        match[1] ? [match[1]] : [],
      ),
    ),
  ];
}

/**
 * Rewrite each `[$name](skill:name)` to the `/name` a person reads. Used
 * wherever the wire form would otherwise leak: a copied message, and the message
 * handed to the model (which would otherwise quote the markup back verbatim).
 */
export function renderSkillMentionsAsText(text: string) {
  return text.replaceAll(
    SKILL_MENTION_PATTERN,
    (raw: string, label: string, target: string) =>
      label === target ? skillMentionLabel(label) : raw,
  );
}

/** How a skill mention reads to a person, on screen and to the model alike. */
export function skillMentionLabel(name: string) {
  return `/${name}`;
}

/** The wire form the composer serializes a skill mention to. */
export function skillMentionToken(name: string) {
  return `[$${name}](skill:${name})`;
}

/**
 * Split a single line into literal text and skill mentions, for rendering. A
 * link whose label and target disagree is not something the composer produces,
 * so it stays literal text rather than becoming a token the user never wrote.
 */
export function splitSkillMention(line: string): SkillMentionSegment[] {
  const segments: SkillMentionSegment[] = [];
  let cursor = 0;

  for (const match of line.matchAll(SKILL_MENTION_PATTERN)) {
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
