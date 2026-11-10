# Check UI copy with a lint rule and a checklist, not prompt rules alone

Date: 2026-11-09

## Context

Agents write most of the words in the app, and copy review kept sending the same kinds of lines back. Going through the agent sessions in this repo from August to November found about 200 corrections to UI copy. Roughly:

| What review sent back | Share | Example |
|---|---|---|
| Lines that read as written by AI, not matter-of-fact | ~30% | "Instrument reads it in a new chat. Chat keeps what's worth keeping." |
| The wrong word for a label | ~23% | Disconnect for Remove, Open table for Expand table, Search DuckDuckGo for Search the web |
| Too long, obvious, or repeating what is on screen | ~17% | "Stop and send" for Send |
| Untrue on some device or in some state | ~10% | "New from your Mac" on a chat that may have come from a PC |
| Our own words on screen | ~10% | "This turn is using …", "Safari.app" |
| Software that hears or picks things up, "we" narrating, odd verbs | ~5%, and inside many of the first row | "a chat hears what you did" |

The UI copy section of `CLAUDE.md` already named most of these, and they kept coming back. Two of the lines review had rejected were still in the app when this was written.

## Options weighed

- **More prompt rules.** The cheapest, and the one already tried. Guidance for prompting models is to say what to do and show it, and quoting the form to avoid can prompt it, so the section was rewritten as how a passing line is written. It helps a writer, but it checks nothing.
- **Vale.** It can lint strings inside `.tsx` since 3.25, and an AI-tells package for it has patterns for "holds" and "X, never Y". It would be a second linter with its own config beside oxlint, which already reads every string and already tells copy from code for `studio/no-os-words`.
- **A rule in the repo's oxlint plugin.** No new tool, runs in the hook that hands lint errors back to the agent in the turn it wrote the line. A pattern can only catch phrases: fewer than one in five of the corrections.
- **A checklist an agent runs.** Yes-or-no questions asked of one string at a time agree with people better than a score does. Run over Studio's 536 longest strings, a nine-question version flagged 45, each with the words that failed, and found both rejected lines still in the app.

## Decision

- `studio/plain-copy` fails lint on the phrases review always rejects, and each message says what to write instead.
- The `copy-review` skill is the checklist, with the lines review passed and the ones it sent back with their replacements, and `scripts/ui-copy.ts` lists the strings to check: all of Studio's, some files', or only the ones a branch added.
- A Stop hook asks a session that added UI strings to run the skill, once.
- The `CLAUDE.md` section says how a passing line is written; the failures and their examples live in the skill, where they are checked against rather than written from.

## Consequences

- A new phrase review keeps rejecting goes into `PLAIN_COPY` in `apps/studio/oxlint-rules.ts`, with what to write instead. A pattern that needs judgment goes into the skill's questions or its table of lines sent back.
- Text for the agent that uses a phrase on the list keeps it under a disable comment, so the rule stays an error.
- The checklist is a model's judgment: its flags are a list to look at, and its rewrites are proposals listed before → after in the PR, never landed without review.
- The string lister finds JSX text, props and properties with a copy name, and toast arguments. Copy kept in a plain constant is missed by it, though not by the lint rule.
