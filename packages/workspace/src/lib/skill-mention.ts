/**
 * The composer serializes a skill mention as `[$name](skill:name)`. This is the
 * workspace-side mirror of the Studio client's `skill-tokens.ts`: it owns the
 * wire form so the two places that read it -- collecting the mentioned names and
 * rendering the mention for the model -- can't drift from each other or from the
 * composer that wrote it.
 */
const SKILL_MENTION_PATTERN = /\[\$([^\]]+)\]\(skill:([^)]+)\)/g;

/** The distinct skill names a message refers to, in first-seen order. */
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
 * Rewrite each `[$name](skill:name)` to the `/name` the user actually typed and
 * sees, so the model reads the message as written rather than the wire form --
 * which it would otherwise quote back verbatim. A footnote on the same turn maps
 * `/name` to the skill it refers to. A link whose label and target disagree is
 * not something the composer produces, so it is left untouched.
 */
export function renderSkillMentionsForModel(text: string) {
  return text.replaceAll(
    SKILL_MENTION_PATTERN,
    (raw: string, label: string, target: string) =>
      label === target ? skillMentionLabel(label) : raw,
  );
}

/** How a skill mention reads to a person: the same `/name` the composer shows. */
export function skillMentionLabel(name: string) {
  return `/${name}`;
}
