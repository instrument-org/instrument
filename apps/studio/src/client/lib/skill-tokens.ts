/**
 * Color alone marks a skill mention, in the composer and the transcript alike.
 * In the composer it also has to stay out of the text flow's way, which is what
 * lets the caret sit beside it. The parse itself lives in
 * `@instrument-org/shared/skill-mention`, shared with the workspace.
 */
export const SKILL_TOKEN_CLASS_NAME =
  "font-medium text-brown-700 dark:text-brown-500";
