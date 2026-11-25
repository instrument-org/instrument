---
name: monitored-release
description: Cut, watch, and publish an Instrument release end to end — tag, push, monitor CI, handle a failed leg, write the notes, check what the agent is told about the app, verify the update feed. Use when asked to ship a release or a beta, or to carry one that is already building through to published.
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

Add `--version <x.y.z[-beta.n]>` to any of them to tag that exact version instead of the next one, for a release that skips ahead (a milestone beta). It must be greater than `apps/studio/package.json`'s version.

**A stable release rewrites every channel's update file that serves an older version.** `generateUpdatesFilesForAllChannels` is on, so publishing a stable build rewrites `beta.yml` and `alpha.yml` alongside `latest.yml`, unless that channel already serves something newer (`release-channels.ts`), which a stable cut behind the betas leaves alone. Which channels the Windows leg packs is decided when it runs, so a stable and a beta cannot be in flight together. Sequence them and let the first finish before tagging the second.

## Before you tag

Five checks. Skipping one is how a release ships another agent's work, or fails twelve minutes in.

**1. Other agents are working in this checkout.** `ListAgents`, then message whoever is busy: how long, and is their work shippable. Expect at least one to ask to be tagged around, and honor it. The tag takes HEAD's tree, so uncommitted work stays out on its own and you never touch their files. If an agent lands work in stages, ask it to tell you which commit is a shippable point; you cannot tell a coherent stage from a half-finished one by reading the log.

**2. Pin the registry.** The script refuses to tag unless `git log HEAD..origin/main` inside `registry/` is empty.

```bash
cd registry && git fetch origin && git checkout origin/main
```

Then commit the gitlink by path from the repo root. Ask whoever is working in the skills repo whether its main is where they want it, and check that it is green there: a red submodule pin is a red release.

**3. Verify in a separate worktree, not this one.** A green run in the shared checkout tests other agents' uncommitted edits, not what you are about to tag.

```bash
git worktree add --detach <scratch>/verify <sha>
.claude/hooks/worktree-setup.sh <scratch>/verify
cd <scratch>/verify && pnpm check-and-test:ci --force
```

**4. Know the baseline before calling anything broken.** `check:unused` (knip) has failed across several releases in a row. Check the previous tag out in the same worktree and run `pnpm knip` there before reporting a regression. `--output-logs errors-only` prints nothing for a passing task, so read the final `Tasks: N successful, M total` line rather than reading a quiet log as a full run.

**5. Check what the agent is told about the app.** Start this while step 3 runs. It never holds the tag: what it finds goes in the release report, and only a finding that would have the agent tell people to do something harmful waits for a person. Take the range the notes use, from the last published release (`gh release list`) to HEAD.

- **Claims.** Read the range's diff of `packages/workspace/system-skills/instrument-guide/SKILL.md`, `packages/workspace/src/model-text/`, and the app code those touch. Check each claim the changed lines make against the code as it stands. Then turn it around: for each change in the range a person would notice (a new menu item, a moved button, a setting), find the guide or prompt line that describes it, and say which ones no line covers or a line now gets wrong. `reference.md` is generated, so only the hand-written files can drift.
- **Gains the agent lacks.** For each thing a person can now do in the app, say whether the agent can do it or see it too: an `instrument` command (`packages/workspace/src/lib/capabilities/`), or a fact in what `instrument window list` prints. One the person has and the agent does not is a gap to name, not a bug.
- **The 30 questions.** `ui-truth/questions.json` holds questions people ask about the app, each with the answer read off the code and the text it was read off. First keep the key current:

  ```bash
  node scripts/ui-truth.ts check --since <last release tag>
  ```

  An answer whose text is gone is out of date, and one whose files changed is listed. Read each listed answer against the code and correct it (and its `readOff`) in a commit of its own before asking, so the key never grades against the app as it was. Then ask a small model that has only the guide, one question at a time (about 3 seconds each):

  ```bash
  node scripts/ui-truth.ts ask --out <outside the repo>/ui-truth.md
  ```

  Grade each reply against the key: correct, partly, doesn't know, or wrong (a wrong place or name, or saying something isn't there when it is). For each wrong reply, ask that question again with `--guide-from <last release tag> --only <ids>`, which says whether this release made it wrong. Report every wrong reply, the ones new in this release first, with the guide line that misled it or the gap it fell into. "Doesn't know" is the guide being silent: count those, and name any that were answered before.

When a change adds something people will ask about, add a question in the same shape. Keep the set to questions a person would ask, with answers that can be read off the code.

Booting the packaged app is CI's job, not yours. Boot locally only when the release turns on something a boot would expose, and then use `studio-drive.mjs boot --purpose <purpose> --workspace <fixture>` for a disposable instance. Never drive an instance you did not start; someone is using it.

## Write the notes

The notes go in before the tag, not after the build: the tag's message is the release notes. The workflow posts their summary line and the lead sentence of each section's first bullets to Slack, links the rest, and publishes them as the release body. Slack cannot be edited afterwards, so what the tag carries is what the channel reads.

1. Read `.agents/skills/release-notes/SKILL.md` for the range and the voice. It is user-invocable only, so read the file rather than invoking the skill.
2. Write the notes to a file outside the repo, and preview what Slack will show:

```bash
node apps/studio/scripts/release-summary.ts slack --notes <path>
```

The range runs from the last **published** release, not the last tag. A tag whose build failed never published, so its changes belong in the next tag's notes: carry them over rather than writing only what is new since the failed tag.

## Tag and push

```bash
cd apps/studio && pnpm tag:release:patch:beta --notes <absolute path>
```

The script rebases the branch onto origin's, bumps `apps/studio/package.json`, commits that file alone as `release: vX.Y.Z` (anything another agent has staged stays out), creates the tag with the notes as its message, and pushes the branch and the tag together in one atomic push. Without `--notes` it still tags, and Slack and the release page fall back to the commits grouped by scope. The tag is what triggers the workflow.

The rebase brings in whatever reached origin since you verified. The script prints those commits; name them in your report as unverified.

If origin moves between the rebase and the push, the push is rejected, and the script deletes its unpushed tag, rebases the release commit, tags it again, and retries. Never fix a rejected release push with `git merge origin/main`: that leaves a merge commit on main. If the script gives up, HEAD is the untagged release commit and its error prints the tag-and-push command to run after you rebase by hand. Do not rerun the script, which would bump the version again.

A pushed tag cannot be moved. A mistake costs the next version number.

The script runs `git fetch origin --tags` without `--force` before it bumps anything, so a clone whose local tags disagree with origin's dies there with a wall of `would clobber existing tag` lines and no version change. Every such tag so far has been a leftover of a history rewrite: same tree, date, and message as origin's, a different sha, and not on `origin/main`. Confirm it on one tag: `git ls-remote origin refs/tags/<tag>` for origin's sha, then `git rev-parse <tag>^{tree} <sha>^{tree}` should print the same tree twice. Then `git show-ref --tags > <backup>` and `git fetch origin --tags --force`, and rerun. Tag refs live in the common git dir, so the force-fetch reaches every worktree of the clone.

## Watching

```bash
gh run list --workflow=release.yml --limit 3
gh run watch <id> --exit-status
```

Five platform legs, about fifteen minutes. Each leg smoke tests the app it just signed, and **publishing is gated on every leg succeeding**, so a build that cannot start never reaches the update feed. The smoke test boots the packaged app, runs a bash command from inside the archive, and exercises the vendored binaries the sandbox shells out to.

`fail-fast: false`, so one leg's flake does not discard the other legs' artifacts. Re-run the failed jobs rather than the whole workflow.

- **Transient** — signing or notarization timeouts, runner networking, an artifact upload. `gh run rerun <id> --failed`.
- **Real** — a compile error, a failing test, a package the build cannot find. Fix it on the branch and cut a new tag. There is no way to reuse the number.

## Publish

A beta or alpha tag publishes immediately as a prerelease. **A stable tag lands as a draft** and stays invisible until someone publishes it.

The release body is the tag's notes followed by the **Full Changelog** and **Skills Changelog** compare links. Open it and check it rendered. A correction goes in with `gh release edit v<version> --notes-file <path>`, which reaches the release page and the app's changelog, but not the Slack post already made.

## What's new pictures

When asked to follow the release with What's new pictures or videos, the notes go out with words alone and the media follows once it is approved, so nobody waits on it before publishing.

1. Before tagging, put this note on its own line under the notes' `## What's new` heading. The app reads it, and Slack, GitHub and older builds show nothing of it:

   ```markdown
   <!-- whats-new
   status: pending
   -->
   ```

   While a release is pending, an open What's new page asks again every 10 minutes and fills in when the media lands. A day after publishing the app stops waiting and shows the words alone.

2. Once the release is published, post an Instrument page with the candidate features to show, and take only the ones approved. Take them from a clean room (the `studio-walkthrough` skill), then post a review page of the takes with each feature's line.
3. For each approved feature, make a still (JPEG or PNG) and, for one that moves, an H.264 MP4 with no sound (`render --plain`, cropped to what matters, about 1200 pixels wide). Upload them to the release bucket's `whats-new/<version>/` folder under names of lowercase letters, digits and dashes:

   ```bash
   wrangler r2 object put instrument-releases/whats-new/<version>/zoom.mp4 --file zoom.mp4 --content-type video/mp4 --remote
   ```

   They are served from `https://releases.tryinstrument.com/whats-new/<version>/`, the only place the app loads What's new media from. A retake goes up under a new name, since the edge may keep the old file a while.
4. Edit the notes: set the note to `status: ready`, and under each feature's bullet add its media in an HTML comment on an indented line of its own, a still alone or a still linked to its video:

   ```markdown
   - **Zoom into pictures.** Click a large picture to zoom in right where you clicked.

     <!-- [![Zoom into pictures](https://releases.tryinstrument.com/whats-new/2.0.11/zoom.jpg)](https://releases.tryinstrument.com/whats-new/2.0.11/zoom.mp4) -->
   ```

   The comment keeps the line out of builds older than What's new, which show a newer release's notes in their update card and would draw a blocked picture there. `gh release edit v<version> --notes-file <path>` reaches every app within about 5 minutes, and the app and the website read the comment and play the video.
5. If the follow-up is dropped, edit the note to `status: ready` with no media, and the features show as words.

## Verify the feed

```bash
curl -s https://releases.tryinstrument.com/beta-mac.yml | head -3
curl -s https://releases.tryinstrument.com/latest-mac.yml | head -3
```

The channel you cut shows the new version. Every other channel shows what it showed before, unless you cut a stable release.

## Reporting it

Name the sha you verified and where you verified it, which checks passed, and which failed against the baseline you compared them to. "Tests pass" from the shared checkout is not a claim about the tag. Say plainly what you left out and why, especially any agent's work you tagged around. Then what step 5 found: claims the code no longer bears out, changes the guide doesn't cover, what the person gained that the agent did not, and the 30 questions' tally with every wrong reply, the ones new in this release first.
