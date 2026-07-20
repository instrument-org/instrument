# Skills reach the agent through a mount and a budgeted catalog

Date: 2026-07-20

## Context

Skill discovery reads from nine sources: the skills we bundle, the registry, the
workspace, and the per-agent skills directories of five co-installed agents. Two
questions fell out of that.

**How does the agent author a skill?** The first implementation added a
`save_skill` tool that took a name, a description, an instructions body, and an
array of resources, then wrote the package atomically under `skills/<name>/`. It
refused to overwrite an existing skill and validated every resource path.

**How much context does the catalog cost?** `load_skill`'s description is built
per request and listed every discovered skill's name and description with no
cap. Descriptions are unbounded, and the count is set by whatever the user
happens to have installed. Twenty-five skills is roughly 2.4k tokens; a user
with a large `~/.claude/skills` is an order of magnitude worse, and because tool
descriptions sit in the cached prompt prefix, every skill added or edited
invalidates the cache.

## Decision

**Author skills through a writable mount, not a tool.** The workspace's own
`skills/` directory mounts at `/skills`, a writable peer of the read-only
`/mnt/<name>` attached folders in `WorkspaceFsLayout`. The agent creates and
edits skills with `write_file`, `edit_file`, and bash, the same as any other
file. `save_skill` is gone.

**Budget the catalog.** `renderSkillCatalog` renders within a character budget,
degrading in three steps: every description in full, then descriptions shortened
to a fair share of the remaining budget, then names alone with a count of what
was dropped. Ordering puts bundled and workspace skills ahead of another agent's
home directory, so those are the last to lose detail.

**Honour `disable-model-invocation`.** A skill whose frontmatter sets it is kept
out of the agent's catalog but stays listed in Studio and invocable by name.

## Why

The mount abstraction already carried the invariant a dedicated tool was
re-implementing. `resolveWritableToolPath` decides writability from a mount's
`readOnly` flag; `hostPathEscapesMount` rejects symlink escapes; the bash sandbox
refuses to traverse out of a mount at all. `save_skill`'s path validation was a
second, weaker copy of containment the layout already enforces for every tool at
once.

The tool was also a poor fit for the work. It could create one skill from a
fully-formed payload and nothing else. Revising a skill, renaming one, splitting
a reference file out of an overlong body, or fixing six skills in a sweep all
required either widening the tool until it was a file API or falling back to
tools the agent could not reach. Editing a package of Markdown and scripts is
file editing; modelling it as anything else costs a tool description in every
request and buys a narrower capability.

What the tool did better, we gave up deliberately: staging-dir-then-rename meant
a skill was never half-written, and the duplicate check was enforced rather than
advised. A partial `SKILL.md` fails frontmatter parsing and simply does not
appear in the catalog, so the failure is quiet rather than corrupting, and the
"check before you overwrite" rule moved into `skill-creator`.

On budgeting, Codex's `core-skills` renderer is the only implementation we found
that solves this; opencode and pi-mono both inject every description on every
turn with no cap, and pi's own documentation concedes that models under-trigger
as the list grows. We took Codex's shape: the three-tier degrade, the
priority ordering, and the fair-share allocator, which matters because a fixed
per-skill quota strands budget on skills with short descriptions.

We use a character budget where Codex uses 2% of the context window, because our
model metadata does not carry a context length. That is Codex's own documented
fallback, and the switch is local to one constant if the metadata gains the
field.

## Consequences

- Native binaries cannot reach `/skills`: `resolveNativeHostPath` bridges only
  the task mount, by design. Running a skill's script still means loading the
  skill and running the copy under `work/skills/`.
- Skills outside the workspace stay readable through `load_skill` and are never
  writable. A user's Claude Code or Cursor skills cannot be clobbered.
- The agent can now delete or overwrite a workspace skill. That is the point,
  and it is the same authority it already has over the task directory.
- A skill written mid-session changes the `load_skill` description and so
  invalidates the cached prefix. Moving the catalog into the session-context
  message would fix that at the cost of a new skill not appearing until the
  context rebuilds; we have not made that trade yet.
