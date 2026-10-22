# Reviews

One file per code review, `YYYY-MM-DD-<slug>.md`: what was read, and what came of each finding. The next review starts where the last one stopped and leaves settled findings alone. `REVIEW.md` says what to look for; this folder says what has already been looked at.

## A review file

```markdown
# <Short title>

Reviewed: `<base>..<head>`

<One paragraph: what was asked for and which parts of the code were read.>

## Findings

### A. <The defect, said plainly>

- Status: fixed `<sha>` | declined | open | superseded `<sha>` | not a defect
- Where: [<file name>:<line>](/<path from the repo root>#L<line>)
- What: <the scenario where it goes wrong, a sentence or two>
- Declined because: <only when declined: the reason, written so a later reviewer can tell whether it still holds>
- Note: <optional: follow-up commits, or why a status is uncertain>

## Not covered

<What the request included that no reader got to.>
```

A review of the tree at one commit writes `Reviewed: snapshot at <sha>`. Line numbers are as of the reviewed head (`git show <head>:<path>`); the link opens the file as it is now, where the line may have moved. Letters are per file. A commit that fixes a finding carries `Review: <file> <letter>` (`Review: 2026-10-21-last-day A`) and sets its `Status:` in the same commit.

## How a review uses this folder

1. **Find the starting point.** `rg "^Reviewed:" docs/reviews` lists what earlier reviews read. Code a review already read, and that hasn't changed since (`git log <head>..HEAD -- <paths>`), needs no second read.
2. **Read the code blind.** Readers get `REVIEW.md` and the code, not this folder or the history behind it, so what they find is not shaped by what earlier reviews said.
3. **Check history while verifying.** For each surviving finding, the verifier reads:
   - every `Status: declined` here whose finding has the same root cause,
   - the `Rejected:` and `Commits-to:` trailers on the commits that last touched those lines (`git log -L <start>,<end>:<path>`),
   - `docs/decisions/`.

   A finding that reverses one of these is dropped, or reported with the record it reverses and the evidence that the reason no longer holds.
4. **Write the file** when the review is delivered, every finding `open`. Update a finding's status when it is fixed or declined, in the commit that fixes it or in the same session that declines it.

## What stays out

This repository is public. A review file carries no machine paths or computer names, no pricing, plan or business reasoning (those belong to the API), and nothing about the internal repositories beyond what the app's own code already shows. A finding that can't be written without them is summarized without them, or recorded in the repository it belongs to.
