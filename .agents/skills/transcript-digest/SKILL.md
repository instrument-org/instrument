---
name: transcript-digest
description: Digest an exported Instrument transcript (a `*-transcript.md`, usually in ~/Downloads) before reading it. Use whenever someone hands over a transcript to review, asks how a run went, where its time went, whether it shows harness issues, why a task failed or stalled, or passes a thread transcript whose child tasks matter. Gives timing buckets, failed/repeated/slow calls and one line per step with line numbers, so the Markdown is read only where it matters.
---

# Transcript digest

An exported transcript runs to thousands of lines, most of them the system prompt, loaded skills, and tool output. Reading it top to bottom burns context and still misses what only shows up in aggregate: where the wall clock went, which call failed, which command ran twice, where the run stopped. The digest parses the export once and prints those facts with line numbers into the file.

```bash
node .agents/skills/transcript-digest/scripts/digest.mjs ~/Downloads/<name>-transcript.md
node .agents/skills/transcript-digest/scripts/digest.mjs <thread>-transcript.md --children   # plus every task the thread started
node .agents/skills/transcript-digest/scripts/digest.mjs <file> --json                       # the same, structured
```

No dependencies. It reads only the Markdown, so it works on a transcript from anyone's machine. `--children` is the one part that needs this Mac: it finds `tasks/<id>` folders the thread mentions, next to the thread's own `taskDir`, and exports each through `script:dump-session-transcript` (the `session-transcript` skill). A child whose folder is not here is reported as not found rather than failing the run.

## How to use it

1. Run the digest first, always. Read its header, time split and flags before opening the transcript.
2. Read the transcript only at the line ranges the flags and the step list point to (`sed -n 'A,Bp'` or Read with an offset). The step list's `L` numbers are the step headings; a flagged tool call's line is its `### Tool Call` heading, with the result below it.
3. If the header says the same session was exported more than once, work from the newest export and say which one you used. Identical copies are marked.
4. For a thread (task name "Instrument", `task new` / `task send` in its calls), rerun with `--children` before judging what a child did; the thread only sees the child's receipt. Each child's header gives the path of its exported transcript; read that file at the child's flagged lines rather than running the digest again.

## Reading the output

- **Where the time went** splits each step's wall clock into waiting for the first token, the model writing, tools running past the end of generation, and what is left. It counts only time inside a turn; gaps before the user's next message are listed separately under "Between turns".
- **Flags**, worst first: `error` (non-zero exit or error result), `incomplete` (a call that never finished streaming), `finish` (a step that ended other than `tool-calls`/`stop`, e.g. `aborted`, `length`, `unknown`), `ended-open` (the session stopped mid-call, with the idle time before export), `slow-model` (first token over 10s), `slow-tool` (over 20s), `gap` (over 30s unaccounted inside a turn), `repeat` (a call identical to an earlier one), `big-result` (over 25k characters into context), `truncated`. More than three of one kind collapse into one line with every line number.
- `repeat` is only a lead. Observation commands (`agent-browser snapshot`, `ls`, rereading a file after an edit) legitimately repeat; an identical failing command repeated is the pattern that matters.

## What it cannot see

Anything that needs reading. A tool that reported success but did nothing (a click that returns `✓ Done` without the page changing), a wrong answer, a misread instruction, a model reasoning in circles: none of these trip a flag. The digest says where to look and how long things took; the judgment about what happened still comes from reading those ranges.

It trusts the export's own timestamps. `activeDurationMs` and per-step timings come from the app; a step whose metadata is missing shows `?`.

## Format notes

The parser follows the Markdown `getSessionMarkdown` (`packages/workspace/src/lib/session-to-markdown.ts`) writes: `## User (Turn N) @`, `## Assistant (User Turn N, Step M) @`, `### Tool Call K: name @ time +duration`, `*Response metadata: k=v, ...*`, and `Exit code:` / `> **Error:**` in results. It also reads the 1.x shapes (steps without numbers, arguments as `<tool><arg>` XML). When the exporter's headings change, update `scripts/parse.mjs` to match, and check it against a few saved transcripts: a format it no longer understands shows up as steps with no calls or calls with empty labels, not as an error.
