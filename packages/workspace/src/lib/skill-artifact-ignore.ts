// Dependency installs and tool caches -- machine-generated cruft, not content
// anyone authored. Skipped when listing a skill's files (an installed
// node_modules is thousands of entries that would bury the skill's own scripts
// and references, in the agent's file list as much as the user's), when copying
// a Node skill beside its packages, and when indexing a task's own files. Layered under the
// skill's own .gitignore rather than replacing it: a skill that has one already
// says what its build leaves behind, but most do not, so these have to hold on
// their own.
export const SKILL_ARTIFACT_IGNORE = [
  ".coverage",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".turbo",
  ".venv",
  "__pycache__",
  "node_modules",
  "venv",
];

/** Authored files omitted from a Node skill's built copy. */
export const SKILL_COPY_IGNORE = [
  "SKILL.template.md",
  ...SKILL_ARTIFACT_IGNORE,
  "tests",
  "vitest.config.ts",
];
