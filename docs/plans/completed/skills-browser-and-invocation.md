# Skills browser and invocation

## Goal

Make installed Agent Skills discoverable, inspectable, and manually invokable
from Studio without adding skill creation or import flows.

## Scope

- Discover valid `SKILL.md` packages from the bundled registry, the workspace,
  `~/.agents/skills`, and supported per-agent user directories.
- Follow symlinked skill directories and resolve duplicate names with local
  workspace skills taking precedence over user skills, then bundled skills.
- Expose read-only skill list and detail RPC endpoints.
- Add Skills to the Studio sidebar, with list and detail routes.
- Show skill description, source, location, files, and rendered instructions.
- Replace the prompt textarea with a ProseMirror editor that retains plain-text
  drafts and submission while representing selected skills as inline atoms.
- Open skill completion when a slash-prefixed query is typed, with keyboard and
  pointer selection.
- Put a prompt composer on skill detail pages, seeded with the viewed skill, so
  submission creates a task directly from that page.

## Out of scope

- Creating, editing, importing, installing, or deleting skills.
- Watching skill directories for live filesystem changes.
- Structured mention metadata in agent requests. Skill atoms serialize to a
  stable plain-text invocation that the existing agent/tool flow understands.

## Verification

- Unit tests cover discovery precedence, symlinks, invalid skills, and source
  metadata.
- Focused editor tests cover skill-token serialization and slash-query matching.
- Workspace and Studio type/lint checks pass.
- Studio route generation includes `/skills` and `/skills/$name`.
