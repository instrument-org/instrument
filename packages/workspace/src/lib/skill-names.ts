/**
 * Skills referenced by name from tool descriptions and agent prompts.
 *
 * Centralized so a rename in the skills registry is a single edit here, and
 * covered by `skill-names.test.ts`, which fails if a name no longer resolves to
 * a skill in the registry. Add an entry whenever prompt or tool copy needs to
 * name a skill, rather than inlining the string.
 */
export const SKILL_NAMES = {
  documentToMarkdown: "document-to-markdown",
  pdf: "pdf",
} as const;
