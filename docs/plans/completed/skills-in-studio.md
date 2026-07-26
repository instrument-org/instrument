# Skills in Studio

Status: **completed**. Landed on `main` via PR #71 (`feature/skills-sidebar`), through `studio,workspace: close remaining skills review gaps`. Kept for the design rationale below, which the code does not state.

## What this is

Agent Skills, surfaced in Studio: a browsable list, a page per skill, a slash menu in the composer, and a create-skill flow. Everything user-facing sits behind the `skills` feature flag, off by default.

## Shape of what landed

**Discovery** (`packages/workspace/src/lib/skills.ts`). Nine sources: the bundled system skills, the registry, five co-installed agents' home directories, and two workspace directories. Deduped by canonical directory first (vendor skill directories are usually symlink farms pointing at one real folder, so the same skill is reachable many times over), then by name with the workspace winning. Skills report their real location so the UI can group and reveal them honestly.

**Reaching the agent.** `load_skill`'s description carries a catalog bounded by `renderSkillCatalog` (`skill-catalog.ts`), which degrades in three steps: full descriptions, then descriptions cut to a fair share of the remaining budget, then names alone with a count of what was dropped. Skills whose frontmatter sets `disable-model-invocation` stay out of that catalog but remain listed and user-invocable. When a message names a skill, a `data-skillMentions` part turns into a note telling the model what the mention syntax means and that choosing what to load is its call.

**Authoring.** The workspace `skills/` folder mounts writable at `/skills` alongside the read-only `/mnt` attached folders, so the agent writes skill packages with ordinary file tools. There is no dedicated save tool; see `docs/decisions/2026-07-20-skills-as-a-mount-not-a-tool.md`. `buildBashFs` creates that directory so the advertised `/skills` is real even before the first skill exists.

**Validation.** `validate-skill` (a bash command, `shell-commands/validate-skill.ts`) checks a skill the agent wrote under `/skills` against `validate-skill.ts`. Errors are what the runtime already acts on -- a skill discovery skips (unparseable frontmatter, no description, no closing fence) or `load_skill` refuses (bad `package.json`, missing `uv.lock`). Warnings are the authoring rules and the context budgets, sharing thresholds and the `tokenx` estimator with the skills registry's own CI check. `skill-creator` runs it before reporting success.

**Composer.** A ProseMirror editor where skills are inline atom nodes, serialized as `[$name](skill:name)`. The slash menu uses the same uFuzzy matcher and `FuzzyHighlight` as the command menu.

## Recently closed

**Skill tokens in submitted messages.** `lib/skill-tokens.ts` holds the parse; the composer builds ProseMirror nodes from it and `SkillMentionText` builds spans from it, so the two cannot drift. No read-only editor view in the transcript — the shipped desktop app we compared against renders mentions through its markdown pipeline rather than its composer schema, for the same reason. Copying a message copies the slash form, since neither form pastes back as a token.

**Clickable files.** The rail selects a file into the article; `SKILL.md` is the default and renders as markdown, everything else as highlighted source. Backed by `skill.file`, which reads within the skill directory and reports binary and oversized files rather than pushing them through.

**File counts.** `skill.list` now walks. Measured first: 48 skills, 364 files, 5ms cold. It is cheap because the walk skips dependency trees and stops at `FILE_LIST_LIMIT`, so no cache was warranted.

**Tab title.** `head` awaits `skill.byName` the way the task and project routes do. `lib/skill-title.ts` is gone.

**`skill-creator` stays bundled.** See `docs/decisions/2026-07-21-where-a-bundled-skill-lives.md`.

**Frontmatter parses with `yaml`, not gray-matter.** gray-matter caches by input string and writes the entry before parsing, so a throw left an unparsed shell behind and the same broken SKILL.md read differently on the second pass. `parseFrontmatter` now splits the fence by hand (BOM, CRLF, the `----` horizontal-rule guard, an unterminated block) and hands the block to `yaml`, keeping the newline after the opening fence so a YAML error's line number matches the file.

**The catalog escapes what it embeds.** `renderSkillCatalog` puts discovered names and descriptions into the XML the `load_skill` tool description carries into the system prompt; a description from an unvalidated source could otherwise close its own tag. `escapeXml` handles `<`, `>`, `&`.

## Things worth knowing before you touch this

**Verify visually.** Nearly all of this was written without running Studio, and it showed. The caret-position bug took three attempts because the first two theorized about the token's CSS when the actual cause was that `prosemirror-view/style/prosemirror.css` was never imported — ProseMirror emits a trailing `<br>` after a text block ending in an inline leaf, and its own stylesheet is what neutralizes that. Two of those rounds would have been saved by looking at the DOM once.

**`listSkillFiles` feeds the agent, not just the UI.** It is what `load_skill` uses to tell the agent what a skill contains, and it is capped at `FILE_LIST_LIMIT`. Before it honored ignore rules, an installed skill's `node_modules` consumed the entire cap, so the agent never saw the skill's own scripts. Anything that changes what it walks changes what the agent sees.

**Skill identity includes its discovery root.** The stable ID is `<source>:<directory>`, so installing a namesake cannot retarget a saved route or mention. The directory name remains the plain label people see; the frontmatter `name` is display prose and may be anything.

**Copy names the app.** Skills belong to Instrument, which is itself the agent — so the UI should not talk about "your agents". Use `APP_NAME`, never a literal.

**`pnpm turbo:fix:lint` reorders Tailwind classes in files you did not touch.** It will dirty five or six unrelated components every run. Revert those before committing; `check:lint` tolerates the original order.

**The mount layout is shared ground.** The connectors work adds its own mount and generalizes the same `workspace-fs-layout.ts` functions this work touched. Adopt the existing shape when adding a mount rather than introducing a parallel one.
