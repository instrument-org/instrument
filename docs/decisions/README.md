# Decisions

Why we chose one approach over the alternatives, captured so the rationale outlives the discussion. One Markdown file per decision, named for the date it was made: `YYYY-MM-DD-short-slug.md`.

Record the context, the options weighed, the choice, and why. Link the PR or commit that carried it out. Don't rewrite a decision once made; supersede it with a new dated file that references the old one, and add the pointer to the old one so a reader landing there first is not misled. Factual corrections — a moved path, a dead link — are fine; reasoning is not edited after the fact.

## Index

Newest first. A struck-through entry has been superseded.

| Date | Decision |
| --- | --- |
| 2026-08-26 | [GitHub Issues are the front door for bugs](2026-08-26-github-issues-as-the-front-door.md) |
| 2026-08-15 | [Plugins over connectors](2026-08-15-plugins-over-connectors.md) |
| 2026-08-15 | [anti-slop is not part of the lint pipeline](2026-08-15-anti-slop-is-not-in-the-lint-pipeline.md) |
| 2026-08-12 | [Try again runs the turn again rather than speaking for the user](2026-08-12-try-again-runs-the-turn-rather-than-speaking-for-the-user.md) |
| 2026-08-11 | [A retired data part is read and filtered, not migrated](2026-08-11-retired-parts-are-read-not-migrated.md) |
| 2026-08-06 | [ffmpeg and ffprobe come from a fork, pinned to a release candidate](2026-08-06-ffmpeg-from-a-fork-at-a-release-candidate.md) |
| 2026-07-31 | [pdfium is the PDF engine](2026-07-31-pdfium-is-the-pdf-engine.md) |
| 2026-07-29 | [Controls activate on release](2026-07-29-controls-activate-on-release.md) |
| 2026-07-28 | [Search moves into the shell, on the real ripgrep binary](2026-07-28-real-ripgrep-in-the-sandbox.md) |
| 2026-07-27 | [Untrusted content is bounded by a nonce, not escaped](2026-07-27-nonce-bounded-untrusted-content.md) |
| 2026-07-27 | [Turn context through AsyncLocalStorage](2026-07-27-turn-context-through-async-local-storage.md) |
| 2026-07-27 | [Hover and press feedback does not ease](2026-07-27-hover-and-press-feedback-does-not-ease.md) |
| 2026-07-27 | ~~[Controls activate on press, not release](2026-07-27-controls-activate-on-press.md)~~ superseded by 2026-07-29 |
| 2026-07-25 | [Quit when the last window closes, on macOS too](2026-07-25-quit-when-the-last-window-closes.md) |
| 2026-07-24 | [web_fetch blocks private addresses to match the sandbox](2026-07-24-web-fetch-private-address-guard.md) |
| 2026-07-21 | [A bundled skill lives in the registry only if another agent could use it](2026-07-21-where-a-bundled-skill-lives.md) |
| 2026-07-21 | [Git without the user's credentials](2026-07-21-git-without-user-credentials.md) |
| 2026-07-20 | [Skills reach the agent through a mount and a budgeted catalog](2026-07-20-skills-as-a-mount-not-a-tool.md) |
| 2026-07-15 | [Userland agent sandbox over OS-level isolation](2026-07-15-userland-agent-sandbox.md) |
| 2026-07-15 | [Drop the agent tool in favor of attached-folder mounts](2026-07-15-drop-agent-tool-for-attached-folder-mounts.md) |
| 2026-07-13 | [Workspace browser profile](2026-07-13-workspace-browser-profile.md) |
| 2026-07-10 | [Managed agent-browser wrapper](2026-07-10-managed-agent-browser-wrapper.md) |
| 2026-07-09 | [Branch tasks from chat turns](2026-07-09-branch-tasks-from-chat-turns.md) |
