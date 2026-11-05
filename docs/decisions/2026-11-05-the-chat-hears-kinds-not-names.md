# The chat hears what kinds of things the person just did, not their names

Date: 2026-11-05

## Context

The app keeps a log of what the person does in it ([action-log.md](../architecture/action-log.md)): folders and files opened, edits, moves, chats read, pages visited, errors shown. The question was how a chat's agent should hear it, so that "put them back" after a drag, or "the weather there" after editing a packing list, resolves without the person attaching anything.

Every message already carries what is on screen and every open tab ([view-context-model-text.ts](../../packages/workspace/src/lib/view-context-model-text.ts)), so a place still in a tab was never the gap. What the tabs cannot say is what the person did: a move, an edit, a folder passed through, a chat read and closed.

## Options weighed

A spike ran ten chat cases through the real agent loop, each with the files and log its message leans on, on Claude Haiku 5.5 (three runs a cell) and GLM 5.3 Flash (two):

- **Nothing.** Today's app. The agent searched its way to most places, at up to twice the tokens, and failed every move and edit case: it asked which files, or where "there" was.
- **A command alone**, with one prompt line naming it. The agent ran it unprompted for moves, errors and old files, but rarely for an edit, and missed "the weather there" two times in three.
- **A short note naming paths and titles**, the newest eight rows from the last 30 minutes. It fixed every move and edit case. It also pulled the agent to a file the person had opened over the one their words named: "the contract I just downloaded" went to the wrong contract three times in three on Haiku and twice in two on GLM. Two rewordings of the note's header ("the words decide", "only what happened in this app") changed nothing. On GLM it once suggested "a medical appointment" as the reason in a note to a manager, with an MRI in the log.
- **A long note**, twenty rows from the last hour in sentences with how long the person stayed. No better than the short one, at three times the size.
- **A note with the kinds of things done and no names** ("6m ago · moved 3 files"), plus the command for the names. It kept every win and chose the right contract two times in three on Haiku: 26 of 27 scored runs on Haiku against 24 for the short named note and 21 for nothing; 17 of 18 on GLM against 14 and 14.

## Decision

- Each message a person sends in a chat carries a note of the kinds of things they did in the app since their last message there: at most 30 minutes back and eight rows, with no name, path, title or address in it. The note says it is background and that `instrument activity` gives the names.
- `instrument activity` reads the log with names and paths, for chats and tasks alike.
- The chat's records store only what the note says, so a synced chat and a feedback report carry no names from the log.
- One setting turns both off. It is on by default.

## Consequences

- A message that points at something the person did costs one more command: about five seconds and a median of 30K more tokens a run in the evals, mostly cached reads.
- The names reach the model provider only when the agent asks for them, on the messages that need them.
- One case still goes the wrong way more often than with no log at all: a file downloaded in another app, with another file of the same sort opened in Instrument, and "the contract I just downloaded". The agent reads the list, finds the opened file, and takes it, in 4 of 6 Haiku runs and 3 of 4 GLM runs, where no log at all got it right every time. The reply names the file it read, so the person sees it at once, and asked to delete the file it left the opened one alone in every run.
- The privacy plan's sentence "Instrument does not observe how you use the app" is no longer true as written: the app keeps this log on the computer. What leaves the computer is the note's kinds with a message the person sends, the names when the agent asks, and the report row when the person sends it.
- The eval cases that measured this are `packages/workspace/evals/cases/activity-context.ts`, and they are what a change to the note's words is checked against.
