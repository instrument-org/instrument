# Skill creation flow

## Goal

Let a user start an agent-guided skill creation task from the Skills area and
save the finished package to the workspace's top-level `skills/` directory.

## Success criteria

- Instrument ships a discoverable `skill-creator` system skill.
- The Skills list has a dedicated creation route with a focused prompt.
- The creator runs as a normal task so it can interview and iterate with the
  user.
- The agent can create a new skill package only under `skills/<name>/` through
  a constrained tool.
- Names, frontmatter, resource paths, duplicates, and symlink escapes are
  validated before anything is committed.
- Newly created skills appear in the existing list and can be invoked normally.

## Out of scope

- Editing, deleting, importing, or publishing skills.
- Automated eval and benchmark orchestration.

## Implementation

1. Add the bundled creator skill as an app resource and skill discovery source.
2. Add and test an atomic `save_skill` tool for workspace-local packages.
3. Add the `/skills/new` route and launch affordance.
4. Verify package checks and the user-visible flow, then move this plan to
   `completed/`.

## Result

Completed with a bundled creator skill, constrained atomic save tool, dedicated
creation route, focused tests, scoped checks, and an Electron visual smoke test.
