# Skills from attached folders

Status: proposed. Waits on step 3 of [skills mount instead of copy](./skills-mount-instead-of-copy.md).

## Problem

A folder the user attaches is often a code repository, and a code repository is the one place the skills directory conventions mean what they claim. Today such a folder contributes nothing to the catalog: its `.agents/skills/` is readable if the agent thinks to look there, but it is not listed, not autocompletable, and `load_skill` cannot resolve a name in it.

This is also the case that makes the sibling plan's removal of `<workspace root>/.agents/skills` a correction rather than a loss. That source claimed to hold skills belonging to a code repository while sitting beside the workspace's own skills folder, which is not one. Read inside an attached folder, the same convention says something true.

## Discovery

`getSkillSources` takes the task's attached folders and appends a source per convention each one contains:

```
<folder>/.agents/skills    <folder>/.claude/skills    <folder>/.codex/skills
<folder>/.cursor/skills    <folder>/.gemini/skills    <folder>/.opencode/skills
```

Not the home table re-rooted. Several agents put user-level skills under XDG paths (`~/.config/agents/skills`, `~/.config/goose/skills`, `~/.config/opencode/skills`) with no project-local equivalent, so this is a second, shorter list. `.agents/skills` carries most of the weight, being what the majority of co-installed agents read from a repository.

Only the folder root is scanned. At least one agent walks every directory between its working directory and the project root looking for `.agents/skills`, which is a sensible answer to a question we do not have: a task has no working directory inside an attached folder, so there is no ancestor chain to walk and no reason to prefer one subdirectory's skills over another's.

The source id is the folder's mount name, so a skill that needs qualifying reads as the folder the user attached (`Repo:pdf`). Two conventions inside one folder that both define a skill of the same name collapse to whichever is scanned first. Where those are the same package, the existing canonical-directory and fingerprint dedupe already merges them; where they genuinely differ, a repository is describing one name two ways and either answer is arbitrary.

Two type edits fall out. `SkillSourceKind` gains `attached`, which the compiler then demands in `SOURCE_RANK` and the catalog's `SOURCE_PRIORITY`. `SkillSourceId` is a closed union and has to admit a member derived from a mount name.

The id does not reach the filesystem. `buildSkillMounts` derives `/skills/<source>/` from `getSkillSources(config)` called without folders, so attached sources never become mount segments, and the `work/skills/<sourceId>/` copy destination is gone by then. The id survives only in `skill.id`, `qualifiedName`, and the catalog, all of which are identifiers the agent reads rather than paths anything resolves.

## What `load_skill` returns

Nothing new. After step 3 it reports instructions, a base directory, and a file list instead of copying, and an attached-folder skill's base directory is the path it already sits at: `/mnt/<name>/.agents/skills/<skill>`. The agent can read it at whatever access the folder was granted. No mount, no copy, no relocation.

That is the whole reason this is cheap, and the reason it waits. While `load_skill` still copies, an attached-folder skill would be the only source that does not, needing a special case step 3 then deletes.

`getSkillProvenance` needs no new branch either. An attached folder is outside the writable skills root and its source is not one of ours, so it resolves to `origin: "external"`, which already means not editable and `installDependencies: false`. We do not run `pnpm install` or `uv` for a skill we did not ship, and the existing external-origin note already tells the agent to review it and install dependencies itself if it trusts it.

## Running a skill's scripts

The folder's access level decides nothing about reading. A read-only folder's skills are discovered, listed, autocompletable, and loadable exactly like any other, and its instructions are most of what a skill is.

What access would decide, if we let it, is whether a native binary can run the skill's scripts where they sit. `resolveNativeHostPath` bridges the task mount and, after step 3, the skills mounts. Everything under `/mnt` quarantines to a nonexistent path, and deliberately so: a host path is read and write to the operating system with no symlink check and no path masking, which is true of a folder granted write access just as much as a read-only one. So `node /mnt/Repo/.agents/skills/foo/scripts/bar.ts` fails with not-found.

**Decided: bridge nothing new. The agent copies a script into the task and runs it from there.**

This is already the prescribed pattern for every other file under `/mnt`, and it costs one bash line. What it buys is that read-only and read-write folders behave identically: both contribute skills, and both run those skills' scripts the same way. The alternative below is the one that splits the feature in two, and a user has no way to predict from the folder picker that the access toggle also decides whether a skill works properly.

Recorded and rejected for now: add the skills subdirectories of read-write folders to the list `resolveNativeHostPath` bridges. It is nearly free, since `relativeWithin` already handles a nested mount prefix and no new machinery is needed, and it saves the copy. It costs a second access rule, a behavior difference with no visible cause, and a decision about whether a read-only marking survives a subprocess that we would rather not have to make. Revisit if the copy step shows up as friction in real transcripts rather than in argument.

## Trust

An attached folder is a different trust class from every source that exists today. The others are either ours or something the user installed into their own home directory for an agent they run; this one can be a repository they cloned an hour ago to look at. Its `SKILL.md` descriptions enter `load_skill`'s tool description, which the model reads before the user has looked at any of it.

Two things already hold. `escapeXml` stops a description breaking out of the catalog's markup, and `origin: "external"` stops us installing its dependencies. Neither addresses instructions that are merely persuasive, and no rendering change would.

What the catalog can do is refuse to crowd out what it ships: rank `attached` last in `SOURCE_PRIORITY`, so a repository with forty skills loses its descriptions before ours do under the 8000-character budget, and last in `SOURCE_RANK`, so it never takes a plain name from a skill the user authored.

## Free

- Deduplication, by canonical directory and then package fingerprint, so a folder that is also a checkout of something already indexed collapses on its own.
- Freshness. The catalog lives in `load_skill`'s description, an async function re-evaluated on every model request, so a folder attached mid-session is reflected on the next one with no invalidation to write. This is the one place attached folders do not have the session-context staleness problem.
- Name collisions, through `qualifySkillNames`.
- Studio's skill list and the composer's autocomplete, which read the same RPC route.

## Verification

Attach a fixture repository carrying one skill per convention and confirm each appears in the catalog, resolves by name, and loads with `external` provenance. Attach the same repository twice by different paths and confirm one entry. Attach it read-only and confirm the skill is fully usable, scripts included, by the copy-then-run path.

Then a real agent run: a prompt that only succeeds by using a skill that exists solely in an attached folder, across the model set, checking that the skill is found without being named in the prompt.
