---
name: release-notes
description: Generate stoic, human-readable release notes grouped by product area for a general audience. Use when asked for release notes since a version.
disable-model-invocation: true
---

# Release Notes

Turn the commits since a version into plain, human-readable release notes for end users. Distinct from the `changelog` skill: this one is stoic (not markety), terse, non-technical, and grouped by product area rather than Features/Bug Fixes.

## Steps

1. Determine the version range.
   - If given a version (e.g. "since 1.3.0"), diff `v<version>..HEAD`.
   - Otherwise find the latest non-beta tag (`git tag --list | sort -V`, ignoring `*-beta.*`) and diff the one before it to HEAD.
   - Tags look like `vX.Y.Z`; betas like `vX.Y.Z-beta.N` (ignore betas).
   - Note which changes actually shipped in a tagged release vs. sit unreleased on `HEAD`; fold them together unless the split matters.
2. List commits: `git log --oneline <range> --no-merges`.
3. Keep only user-facing changes (see filtering below). Inspect larger or ambiguous commits before deciding what they mean to a user.
4. Group the survivors by product area, not by commit type.
5. Write a one-line summary of the release, then the grouped bullets. Omit the app name and version: GitHub provides that context around the release body.
6. Return the result in a markdown code block.

## Filtering

Commits are scope-prefixed. Current commits use `scope: description`; older commits may use the conventional form `feat(scope):` / `fix(scope):` / `revert(scope):`, and a few are bare `Revert "..."`. Parse legacy commits by their inner scope; the `feat`/`fix`/`revert` wrapper does not change what to keep or drop. Multi-scope prefixes like `studio,workspace:` are common.

Drop anything a user never sees:

- **Drop by scope**: `dx:`, `docs:`, `cspell:`, `spelling:`, `lint:`, `knip:`, `pnpm:`, `deps:`, `dependencies:`, `eslint-config:`, `skills:`, `release(...)`, dependency bumps, formatter/lint migrations, and dev-only or debug-only work (dev hot-reload behavior, debug launchers, RPC consoles, developer-mode pages).
- **Keep by scope**: `studio:`, `workspace:`, `agent-browser:`, `browser:`, `tabs:`, `task:` / `tasks:`, `session:`, `image-gen:`, `ai-gateway:`, `shim:`, and `registry` updates (bundled skills/content; opaque subjects like "update to latest" need inspection to describe).
- **Then drop by effect**: scope alone is not enough. Within kept scopes, a large share of commits are internal plumbing with no user-visible change (refactors, RPC/IPC channel moves, lifecycle/ownership fixes, phrases like "single-owner", "stream over RPC", "break import cycle"). Keep only commits that change what a user sees or can do. When a commit is half-internal, describe only the part a user would notice.

## Tone

- Stoic and factual. No marketing language ("powerful", "seamless", "delight"), no hype, no exclamation points, no emoji.
- Terse. One line per change. Lead with the behavior, not the mechanism.
- For a general audience: no jargon. Translate internal terms into plain language (e.g. "User-Agent" -> "the browser identifies itself as Chrome"; "session refs" / "data parts" / "tokens" -> describe the effect, not the internals).
- Do not quote commit messages verbatim.
- No em dashes.
- Do not add a release title or repeat the app name or version number.
- Prefer product-area headings (Browser, Tasks, Image generation, etc.) with a final "Fixes and polish" catch-all.

## Example output

```markdown
A maintenance and refinement release focused on the built-in browser, task
handling, and image generation.

## Browser

- Each workspace now keeps its own browsing profile, so logins and cookies stay
  separate between workspaces.
- Type something that isn't a web address into the address bar and it falls back
  to a web search.
- New "View as" menu to preview a page at phone and tablet sizes.
- The browser now identifies itself as standard Chrome, so more sites load
  correctly.

## Tasks

- Branch a task from any point in a conversation instead of duplicating the
  whole thing.
- Finished tasks now show an unread indicator.
- File links in chat stay live and open the current file, rather than a stale
  snapshot.

## Image generation

- Requests now route to the best available model and respect the settings you
  provide.
- Generating an image no longer overwrites earlier ones by default.

## Fixes and polish

- Refreshed shadows and borders throughout the app; tidied the settings
  controls.
- Agents run longer on their own before pausing.
- Fixed a crash that could happen when quitting.
```
