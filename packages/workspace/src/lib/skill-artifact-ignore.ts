// Dependency installs and tool caches -- the cruft a skill accumulates while it
// is developed, not part of what it teaches. Skipped both when listing a skill's
// files (an installed node_modules is thousands of entries that would bury the
// skill's own scripts and references, in the agent's file list as much as the
// user's) and when copying a skill into a task. Layered under the skill's own
// .gitignore rather than replacing it: a skill that has one already says what
// its build leaves behind, but most do not, so these have to hold on their own.
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
