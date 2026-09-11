---
name: monitored-release
description: Cut, watch, and publish an Instrument release end to end — tag, push, monitor CI, handle a failed leg, write the notes, verify the update feed. Use when asked to ship a release or a beta, or to carry one that is already building through to published.
---

# A monitored release

One agent drives this from the tag to the published notes, with nobody watching. The workflow runs about 15 minutes and there is nothing to do while it does, so the work is all in the preflight and in reading a failure correctly.

## Which release

Run from `apps/studio`:

| Command                       | Produces                            |
| ----------------------------- | ----------------------------------- |
| `pnpm tag:release:patch:beta` | next beta on the current patch line |
| `pnpm tag:release:minor:beta` | next beta on the next minor         |
| `pnpm tag:release:patch`      | stable patch                        |
| `pnpm tag:release:minor`      | stable minor                        |

**A stable release rewrites every channel's update file.** `generateUpdatesFilesForAllChannels` is on, so publishing a stable build rewrites `beta.yml` and `alpha.yml` alongside `latest.yml`. A stable and a beta cannot be in flight together. Sequence them and let the first finish before tagging the second.

## Before you tag

Five checks. Skipping one is how a release ships another agent's work, or fails twelve minutes in.

**1. Other agents are working in this checkout.** `ListAgents`, then message whoever is busy: how long, and is their work shippable. Expect at least one to ask to be tagged around, and honor it. The tag takes HEAD's tree, so uncommitted work stays out on its own and you never touch their files. If an agent lands work in stages, ask it to tell you which commit is a shippable point; you cannot tell a coherent stage from a half-finished one by reading the log.

**2. The index must be empty.** `git diff --cached --name-only`. `tag-release.ts` runs `git commit` with no pathspec, so anything another agent has staged rides into the `release:` commit.

**3. Pin the registry.** The script refuses to tag unless `git log HEAD..origin/main` inside `registry/` is empty.

```bash
cd registry && git fetch origin && git checkout origin/main
```

Then commit the gitlink by path from the repo root. Ask whoever is working in the skills repo whether its main is where they want it, and check that it is green there: a red submodule pin is a red release.

**4. Verify in a separate worktree, not this one.** A green run in the shared checkout tests other agents' uncommitted edits, not what you are about to tag.

```bash
git worktree add --detach <scratch>/verify <sha>
.claude/hooks/worktree-setup.sh <scratch>/verify
cd <scratch>/verify && pnpm check-and-test:ci --force
```

**5. Know the baseline before calling anything broken.** `check:unused` (knip) has been failing on `spike/orchestrator` for several releases. Check the previous tag out in the same worktree and run `pnpm knip` there before reporting a regression. `--output-logs errors-only` prints nothing for a passing task, so read the final `Tasks: N successful, M total` line rather than reading a quiet log as a full run.

Booting the packaged app is CI's job, not yours. Boot locally only when the release turns on something a boot would expose, and then use `studio-drive.mjs boot --purpose <purpose> --workspace <fixture>` for a disposable instance. Never drive an instance you did not start; someone is using it.

## Tag and push

```bash
cd apps/studio && pnpm tag:release:patch:beta
cd ../.. && git push origin <branch> && git push origin v<version>
```

The script bumps `apps/studio/package.json`, commits `release: vX.Y.Z`, and creates the tag. Push the branch before the tag, or the branch ref is left behind the commit the tag names. The tag is what triggers the workflow.

A pushed tag cannot be moved. A mistake costs the next version number.

## Watching

```bash
gh run list --workflow=release.yml --limit 3
gh run watch <id> --exit-status
```

Five platform legs and three smoke tests, about fifteen minutes. **Publishing is gated on `build` and `smoke_test` both succeeding**, so a build that cannot start never reaches the update feed. The smoke test boots the packaged app, runs a bash command from inside the archive, and exercises the vendored binaries the sandbox shells out to.

`fail-fast: false`, so one leg's flake does not discard the other legs' artifacts. Re-run the failed jobs rather than the whole workflow.

- **Transient** — signing or notarization timeouts, runner networking, an artifact upload. `gh run rerun <id> --failed`.
- **Real** — a compile error, a failing test, a package the build cannot find. Fix it on the branch and cut a new tag. There is no way to reuse the number.

## Notes and publish

A beta or alpha tag publishes immediately as a prerelease. **A stable tag lands as a draft** and stays invisible until someone publishes it.

The workflow writes an auto-generated commit list as the release body. Replace it wholesale:

1. Read `.agents/skills/release-notes/SKILL.md` for the range and the voice. It is user-invocable only, so read the file rather than invoking the skill.
2. `gh release edit v<version> --notes-file <path>`

Replacing the body drops the auto-generated **Full Changelog** and **Skills Changelog** compare links. Every release so far has accepted that; append them if you want them kept.

## Verify the feed

```bash
curl -s https://releases.tryinstrument.com/beta-mac.yml | head -3
curl -s https://releases.tryinstrument.com/latest-mac.yml | head -3
```

The channel you cut shows the new version. Every other channel shows what it showed before, unless you cut a stable release.

## Reporting it

Name the sha you verified and where you verified it, which checks passed, and which failed against the baseline you compared them to. "Tests pass" from the shared checkout is not a claim about the tag. Say plainly what you left out and why, especially any agent's work you tagged around.
