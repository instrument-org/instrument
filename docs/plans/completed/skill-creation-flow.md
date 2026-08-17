# Skill creation flow

Status: **complete.** See the Result below, and [2026-07-20-skills-as-a-mount-not-a-tool.md](../../decisions/2026-07-20-skills-as-a-mount-not-a-tool.md) for why the writable mount replaced the dedicated save tool this plan first shipped.

## Goal

Let a user start an agent-guided skill creation task from the Skills area and save the finished package to the workspace's top-level `skills/` directory.

## Success criteria

- Instrument ships a discoverable `skill-creator` system skill.
- The Skills list has a dedicated creation route with a focused prompt.
- The creator runs as a normal task so it can interview and iterate with the user.
- The agent can write skill packages only under the workspace's own `skills/` directory, reached through the writable `/skills` mount.
- Path escapes out of that mount, including via symlink, are rejected by the same layout checks that contain every other mount.
- Newly created skills appear in the existing list and can be invoked normally.

## Out of scope

- Editing, deleting, importing, or publishing skills.
- Automated eval and benchmark orchestration.

## Implementation

1. Add the bundled creator skill as an app resource and skill discovery source.
2. Mount the workspace `skills/` directory writable at `/skills`.
3. Add the `/skills/new` route and launch affordance.
4. Verify package checks and the user-visible flow, then move this plan to `completed/`.

## Result

Completed with a bundled creator skill, a writable `/skills` mount the agent writes through with its ordinary file tools, a creation flow launched from the Skills list (a modal rather than the `/skills/new` route this plan sketched), focused tests, and scoped checks. See `docs/decisions/2026-07-20-skills-as-a-mount-not-a-tool.md` for why the mount replaced the dedicated save tool this plan originally shipped.
