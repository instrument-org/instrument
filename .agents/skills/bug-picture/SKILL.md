---
name: bug-picture
description: Turn a bug report, a Slack thread, a session write-up, a transcript or a plain description into one Instrument page that shows each claimed bug as it looks today and how the proposed fix would look, after checking each claim against the code. Use when someone hands over a batch of problems to triage before approving fixes, asks to "show me the bug", "picture these", or wants to see what would change before saying go.
---

# Bug picture

The point is to stop approving fixes for things that aren't bugs. A list of claims reads as true; a picture of the build, made after reading the code, often doesn't. On the first run, three of ten items in a tester's session turned out to be something other than what the report said, and the code check caught all three before any screenshot did.

So the order matters: claims, then code, then pictures. Never picture a claim you haven't checked in the code.

## 1. Pull out the claims

Read the source once and list every claimed problem, lettered A, B, C. One line each, in the reporter's terms: what they saw, where, and what they expected. Keep their stills and timestamps beside each letter; they're the fallback picture.

- Slack thread: `slack_read_thread`; a page linked there is read per the `instrument-page` skill's sharing reference.
- Problem report: the reports CLI (`agent-reference get internal`, then `reports show <fingerprint>` / `reports files <id>`).
- A chat's records or a transcript: the `transcript-digest` skill first.

## 2. Check each claim in code

For each letter, find the code that draws or decides it and write `file:line` beside it. Open every cited line yourself, including any a subagent cites. Then give it a verdict:

| Verdict | Means |
| --- | --- |
| Fix | the code does what the report says, and the fix is small and clear |
| Unclear | couldn't reproduce it, or it depends on data you don't have |
| Cause unknown | it happened, but the code path the report implies doesn't explain it |
| Needs their data | only the reporter's files or records can settle it |
| Design call | the code does it on purpose; a person decides, not a fix |

Write down where the report's explanation and the code disagree. That's usually the most useful line on the page.

## 3. Picture what's cheap to reach

Boot a disposable fixture (`studio-chrome-devtools` skill), never the developer's own instance:

```bash
DRIVE=.agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs
node $DRIVE boot --purpose bug-picture --workspace documents
node $DRIVE run shots.mjs --workspace documents   # --workspace on every command
node $DRIVE stop --workspace documents
```

Set state up through RPC, not clicks: it's faster and doesn't break when copy moves. [`recipes.md`](recipes.md) has the setups that came up so far and the selector traps. One `run` script per item or two, each saving `<letter>-before.png`.

Budget a few minutes per item. When a state is expensive (a permission prompt, dictation, a first launch, the reporter's own data), use the report's still instead and say so in the caption. Don't build a scenario to picture one item unless it's the item that decides the batch.

## 4. Mock the after on the live page

For each Fix, edit the live DOM over CDP to show the proposed change, in the same run, and shoot `<letter>-after.png`. Label every one "mocked" on the page. Don't build the fix to picture it: the picture is what gets it approved.

When the fix changes copy, follow `CLAUDE.md`'s UI copy rules in the mock, so what's approved is what ships. When a fix has more than one plausible shape, mock each as its own frame and let the reader pick.

## 5. One page, ranked by verdict

Build it with the `instrument-page` skill, in `~/visual-answers/<date>-<short-name>/`.

- Headline: the count, "Seven real fixes, three that aren't what they seemed".
- Hero: a verdict table with one row per letter: what, how it was seen (running build, report still, code only), and the verdict.
- Then the Fix items, each with before and mocked after (`.pair`), the `file:line`, and the fix in one sentence.
- Then everything else, each saying why it isn't a plain fix and what would settle it.
- Footer: the commit the build ran, the fixture, which pictures are the report's own, which are mocked.

Dense: one or two sentences per item. The pictures carry it.

## 6. Hand it over

Give the page's link line and a short verdict list the reader can answer by letter. Fix nothing until they say which letters go.
