/**
 * Color alone marks a skill mention, in the composer and the transcript alike.
 * In the composer it also has to stay out of the text flow's way, which is what
 * lets the caret sit beside it. The parse itself lives in
 * `@instrument-org/shared/skill-mention`, shared with the workspace.
 */
export const SKILL_TOKEN_CLASS_NAME =
  "font-medium text-brown-700 dark:text-brown-500";

/**
 * How a search highlights the run of characters it matched in a skill name.
 * Weight is already spoken for -- a name is set in its own face, and `<mark>`
 * brings its own background -- so the match reads as the same brown that marks a
 * skill everywhere else instead.
 */
export const SKILL_NAME_MATCH_CLASS_NAME = `bg-transparent ${SKILL_TOKEN_CLASS_NAME}`;
