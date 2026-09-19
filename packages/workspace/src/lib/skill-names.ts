/**
 * Skills referenced by name from tool descriptions and agent prompts.
 *
 * Centralized so a rename in the skills registry is a single edit here, and
 * covered by `skill-names.test.ts`, which fails if a name no longer resolves to
 * a skill in the registry. Add an entry whenever prompt or tool copy needs to
 * name a skill, rather than inlining the string.
 */
export const SKILL_NAMES = {
  createPage: "create-page",
  documentToMarkdown: "document-to-markdown",
  docx: "docx",
  pdf: "pdf",
  powerpoint: "powerpoint",
  spreadsheet: "spreadsheet",
} as const;

/**
 * The skills a brief may name: each makes a kind of thing a user asks for by
 * name (a page, a PDF, a Word document, a slide deck, a spreadsheet), so the
 * agent writing the brief has to know it exists. Every other shipped skill is
 * a way of working (the browser, media, images, archives) that a task reaches
 * for on its own; naming one in a brief tells the task how to work rather
 * than what to make, and the agent that briefs is not told about them.
 */
export const DELIVERABLE_SKILLS: ReadonlySet<string> = new Set([
  SKILL_NAMES.createPage,
  SKILL_NAMES.docx,
  SKILL_NAMES.pdf,
  SKILL_NAMES.powerpoint,
  SKILL_NAMES.spreadsheet,
]);
