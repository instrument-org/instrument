---
name: find-ui-changes
description: Find recent product UI surfaces changed by Instrument commits that may need human review. Use when asked to find UI changes, surface UI changes, create a design or UI review queue, prepare a designer handoff, or identify app changes needing design attention.
---

# Find UI Changes

Create a concise queue of review-worthy UI changes from recent commits. This is not a release changelog. The goal is to identify product surfaces a human may want to inspect, with enough repo context for a designer or agent to follow up.

## Inputs

Accept ranges such as:

- `HEAD~20..HEAD`
- `v1.3.0..HEAD`
- `since Monday`
- `last 48 hours`
- `last two weeks`
- `since the last public release`
- `since the previous stable tag`

If the range is ambiguous, state the assumption. For relative dates, include the exact dates used.

## Discovery

1. Inspect commit subjects, bodies, authors, co-authors, and touched files.
2. Sample diffs for likely UI changes; do not rely only on commit subjects.
3. Cluster related commits into reviewable UI surfaces.
4. Infer human app locations from where components render in the product, not from route filenames alone.

Useful commands:

```bash
git log --date=short --pretty=format:'%h%x09%ad%x09%an <%ae>%x09%s' <range>
git log --format='%h%x09%an%x09%ae%x09%s%n%B%n---END---' <range>
git show --stat --oneline <sha>...
git show --name-only --oneline <sha>
```

## Filter

Include:

- User-visible Studio UI and product surfaces.
- New controls, panels, modals, workflows, navigation, empty/error states, or layout behavior.
- Refactors only when they change layering, scaling, navigation, modality, persistence, state visibility, or interaction behavior enough to merit review.

Exclude:

- Commits authored by or co-authored with Neil Renicker, unless the user asks to include designer-owned work.
- Internal-only changes, tests, telemetry, diagnostics, release commits, dependency churn, spelling, or docs-only commits.
- Small spacing, border, token, and polish changes unless they create a reusable visual pattern.
- Architecture changes where the intended UI stayed the same.

When uncertain, prefer omitting marginal items. The queue should be short enough for a designer to scan.

## Screenshots

Optional, and only when the user asks for them. A queue without images is still a complete answer.

When asked, capture one image per surface from the running app and reference it in that surface's entry. See [references/capturing-screenshots.md](references/capturing-screenshots.md) for connecting to Studio, driving it, and cropping.

Two things to settle before starting, because both can invalidate the work:

- Screenshot the checkout the range came from, on a build that has nothing newer affecting those surfaces.
- Ask where the images should end up, and get approval for that batch before uploading anything. Putting them anywhere outside this machine, Notion included, means a third-party host sees them first.

## Output

Use this shape:

````markdown
- **Concrete surface name**

  Location: where a designer can find it in the app, described as a page, modal, panel, toolbar, debug page, or workflow. Do not show internal route paths unless the user asks for technical routing details.

  One short sentence describing what changed.

  Source changes: [abc1234](https://github.com/instrument-org/instrument/commit/abc1234), [def5678](https://github.com/instrument-org/instrument/commit/def5678)

  Screenshot: <path or link, only when screenshots were requested>

  ```text
  Use these commits as repo context for <surface name>: abc1234 def5678

  Location: Same human app location, without route paths.
  ```
````

Guidelines:

- Heading: 3-8 concrete words.
- Description: one sentence, plain and specific.
- Location: describe the product place, not the implementation path.
- Source changes: Markdown commit links are useful secondary context.
- Context block: commit hashes and human location only. Do not include a request placeholder or text the designer would need to delete.
- Keep prose terse. Avoid recommendations unless the user asks for them.
- Do not soft-wrap prose. Keep each paragraph and list item on one source line.

## Common Locations

Use product language like:

- Studio task page, artifact panel
- Studio task page, prompt input
- Studio task page, inline file previews
- Main Studio window, left sidebar
- Main Studio toolbar
- Settings modal
- Welcome or onboarding flow
- Debug page
- Provider/model picker
- File viewer
- Project page

## Commit Links

This repo's GitHub commit URL format is:

```text
https://github.com/instrument-org/instrument/commit/<sha>
```
