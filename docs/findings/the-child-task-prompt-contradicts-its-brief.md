# The child task prompt contradicts its brief

**Status:** resolved 2026-09-10, on both sides. Recorded 2026-09-10. The orchestrator's briefing rules now state the handoff contract (what a finished task hands back is the first 400 characters of its last message and the files it wrote, both interpolated from `wake-summary.ts`), so a brief names a file and a folder and never asks for findings in the reply or promises to place the file afterward; `task new`'s help says the same. `who_reads_you` gained the one rule it lacked for a brief that still asks (the receipt carries a verdict in a clause, never a list) and lost a claim that was false: the assistant reads a task's `output/` through `MOUNT.tasks`, and the wake note lists the files written, so `output/<name>` is a path it can open and the task is told so. The second candidate shape below, a structured return channel, is not built.

A task started by the orchestrator gets a `who_reads_you` block describing the handoff, and separately gets the orchestrator's own brief as its first user message. The two disagree on the two things that decide whether the handoff works.

## Contradiction one: whether to summarize

`who_reads_you`:

> Your last message is a receipt, not a report: one or two sentences saying what you made and anything the assistant has to act on. **Never summarize the file's contents, never restate its findings, never repeat its sources.**

The brief the orchestrator wrote, in the same session:

> Report back one line naming the file plus **3-5 headline findings**.

Headline findings are a summary of the file's contents. The prompt forbids exactly what the brief asks for.

This is not a hypothetical tie: only the first 400 characters of the last message travel back, so a task that obeys the brief spends its whole budget on findings that may be truncated mid-sentence, and one that obeys the prompt hands back a receipt the orchestrator then has to open the file to act on. `scripts/orchestrator-handoff-report.ts` exists specifically to show what the 400-character cut dropped, which suggests this has bitten before.

## Contradiction two: which path to name

`who_reads_you`:

> Name every file you made by a path that resolves outside this task: a folder under `/mnt/` when the brief gave you one, in the path you reach it at. **A path of your own like `output/report.md` means nothing to it.**

The brief:

> Deliverable: write the report to your `output/` as `claude-code-overview.md` (I will place it).

The prompt does defer to the brief on location (`When the brief named a folder for the deliverable, that is where it goes, over anything this prompt says about output/`), so the file lands correctly. What it does not resolve is what to *say*: the task must name a path, the only path it has is `output/claude-code-overview.md`, and the prompt has just told it that path is meaningless to the reader. "I will place it" is the orchestrator's plan for handling that, but nothing in the prompt knows the orchestrator said it.

## Where the fix belongs

On the orchestrator side, not in `who_reads_you`. The prompt is describing a real constraint (the 400-character wake summary, the fact that task-relative paths do not resolve for the caller) and both of its rules are correct given that constraint. What is wrong is that the orchestrator writes briefs as if it were talking to a person: "report back N findings" and "I will place it" are both instructions a human contractor understands and a prompt-governed task cannot reconcile.

Two candidate shapes:

- Teach the orchestrator the handoff contract when it composes a brief, so it stops asking for summaries and stops promising to move files. It knows the constraint; the brief is where that knowledge is currently absent.
- Or make the contract real in the other direction: give the task a way to return structured findings that is not the 400-character message, at which point the brief's request becomes answerable and `who_reads_you` can stop forbidding it.

The first is cheap and removes the contradiction. The second is what the brief keeps reaching for, which is some evidence it is the thing actually wanted.
