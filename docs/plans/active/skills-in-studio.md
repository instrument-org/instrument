# Skills in Studio

Handoff for `feature/skills-sidebar` (PR #68). The branch is rebased on `main`,
linear, and green on `pnpm check-and-test:ci`.

## What this is

Agent Skills, surfaced in Studio: a browsable list, a page per skill, a slash
menu in the composer, and a create-skill flow. Everything user-facing sits
behind the `skills` feature flag, off by default.

## Shape of what landed

**Discovery** (`packages/workspace/src/lib/skills.ts`). Nine sources: the
bundled system skills, the registry, five co-installed agents' home
directories, and two workspace directories. Deduped by canonical directory
first (vendor skill directories are usually symlink farms pointing at one real
folder, so the same skill is reachable many times over), then by name with the
workspace winning. Skills report their real location so the UI can group and
reveal them honestly.

**Reaching the agent.** `load_skill`'s description carries a catalog bounded by
`renderSkillCatalog` (`skill-catalog.ts`), which degrades in three steps: full
descriptions, then descriptions cut to a fair share of the remaining budget,
then names alone with a count of what was dropped. Skills whose frontmatter
sets `disable-model-invocation` stay out of that catalog but remain listed and
user-invocable. When a message names a skill, a `data-skillMentions` part turns
into a note telling the model what the mention syntax means and that choosing
what to load is its call.

**Authoring.** The workspace `skills/` folder mounts writable at `/skills`
alongside the read-only `/mnt` attached folders, so the agent writes skill
packages with ordinary file tools. There is no dedicated save tool; see
`docs/decisions/2026-07-20-skills-as-a-mount-not-a-tool.md`.

**Composer.** A ProseMirror editor where skills are inline atom nodes,
serialized as `[$name](skill:name)`. The slash menu uses the same uFuzzy matcher
and `FuzzyHighlight` as the command menu.

## Open work, roughly in priority order

### 1. Render skill tokens in submitted messages

A sent message still shows raw `[$docx](skill:docx)` in the transcript. This is
the most visible remaining defect.

The parse already exists: `promptDocFromText` in
`apps/studio/src/client/components/prompt-editor-model.ts` turns the serialized
form into a document. The open question is what renders it in the transcript. A
read-only ProseMirror view per message is the obvious reach and probably the
wrong one for a long scrolling list; a small renderer over the same parse is
likely better. the reference open-in pattern handles the equivalent
problem and its docs cover it — read that before choosing.

### 2. Click through the skill's files

The right-hand rail on a skill page lists files but they are not clickable. They
should open in the existing syntax-highlighted viewer, with `SKILL.md` selected
by default and the rail showing which file is current. No router involvement
wanted — local state is fine.

### 3. File counts in the listing

Tasteful per-card metadata (file count, and whatever else is already cheap) on
`/skills`. Note the cost: `skill.list` does not currently walk skill
directories, only `skill.byName` does. Adding a count means a walk per skill, so
either measure it or cache it rather than assuming it is free.

### 4. Tab title uses the display name

`routes/_app/skills/$name.tsx` still derives its tab title from the route param
through `lib/skill-title.ts`'s title-casing, because TanStack's `head` only sees
params. The page body uses the frontmatter name. Thread the real title through
the loader and delete `skill-title.ts` once nothing uses it.

### 5. Consider moving `skill-creator`

It ships as a system skill and shows under "Provided by Instrument". It may
belong in the registry instead, which would leave the bundled source empty.

## Things worth knowing before you touch this

**Verify visually.** Nearly all of this was written without running Studio. The
caret-position bug took three attempts because the first two theorized about the
token's CSS when the actual cause was that `prosemirror-view/style/prosemirror.css`
was never imported — ProseMirror emits a trailing `<br>` after a text block ending
in an inline leaf, and its own stylesheet is what neutralizes that. Two of those
rounds would have been saved by looking at the DOM once.

**`listSkillFiles` feeds the agent, not just the UI.** It is what `load_skill`
uses to tell the agent what a skill contains, and it is capped at
`FILE_LIST_LIMIT`. Before it honored ignore rules, an installed skill's
`node_modules` consumed the entire cap, so the agent never saw the skill's own
scripts. Anything that changes what it walks changes what the agent sees.

**The directory name is the identity.** The frontmatter `name` is display prose
and may be anything; the directory name is what is unique on disk and what the
agent, the slash menu, and `load_skill` address. Do not swap them.

**Copy names the app.** Skills belong to Instrument, which is itself the agent —
so the UI should not talk about "your agents". Use `APP_NAME`, never a literal.

**`pnpm turbo:fix:lint` reorders Tailwind classes in files you did not touch.**
It will dirty five or six unrelated components every run. Revert those before
committing; `check:lint` tolerates the original order.

**`check:unused-words` fails in any worktree nested under `.claude/worktrees/`.**
It lacks the `--gitignore-root .` flag that `check:spelling` passes, so it
inherits the parent repo's `.gitignore` and scans nothing. Not caused by this
branch, and not part of CI.

## Conflicts to expect

`jmack/connectors-v1` adds a `connectors` mount and generalizes the same
`workspace-fs-layout.ts` functions this branch touched. Whichever lands second
should adopt the other's shape rather than merging both.
