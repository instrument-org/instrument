# Haiku narrates between tool calls, and prompt wording does not move it

The agent's prompt says work over several calls gets one line at the start and the outcome at the end, with nothing between. Claude Haiku 5.5 writes between calls anyway, in about half of its multi-call stretches; GPT-6.1 Sol almost never does.

**What was seen.** Counted over eval records and real chats, a stretch being an assistant's calls between two user messages, with a task's wake starting a new one so a reply to a finished task does not count: Haiku 5.5 wrote between calls in 46% of chat stretches and 53% of task stretches; GPT-6.1 Sol in 4% and 0%; Grok 4.7 in nearly all, on a small sample. Haiku's lines are running bookkeeping ("Page 1 is in the cart at $7.36. Moving to page 2."), restating what each call's `activity` and `explanation` already show, and a few real asks a permission card already makes.

**What was tried.** A stronger rule (write nothing between calls, neither what you found nor what you will do next, since the steps fold behind one line; words only to say you are stopping or to answer something asked mid-work), scored on Haiku 5.5 with `tab-lock-two-tasks` and `tab-lock-quick-check`, three repeats each on the old and new prompt. Lines between calls went from 36 to 34 in the chat and 12 to 9 in tasks, within noise, so it was not kept. Simple file jobs (renaming a folder's files, totaling CSVs) drew no narration on either prompt, so they cannot show a change: browser and task work is where it appears.

`tab-lock-chat-does-the-job` is the case that shows it: the chat adds the shop's items under $3 across four pages itself, a dozen browser calls in one turn, and its `quietBetweenCalls` assertion counts the steps that wrote to the user and then called another tool. On Haiku 5.5 it narrates in every run, a line per page ("Page 2 has five items under $3: ... Moving on to page 3."). Three repeats each of that case, `tab-lock-quick-check` and `chat-one-file`:

| Prompt | Lines between calls, does-the-job | Stretches with words between, all cases | Median tokens, does-the-job |
| --- | --- | --- | --- |
| Unchanged | 25 (9, 6, 10) | 5/5 | 530K |
| The prompt's lead-line rule and the turn note send between-step news to each call's `explanation`, and words only to answer, for something that needs the user, or with the outcome | 22 | 4/4 | 570K |
| Both of those, plus a note on every chat step after a tool call ("Carry on. Write to the user only when something needs them, or with the outcome."), confirmed in the request notes | 22 | 5/6 | 446K |

Every run passed its other assertions, and every typed turn but one still opened on a line. So pointing the habit at `explanation`, and saying it again at every step, moves it no more than the stronger rule did.

**Why it matters less now.** A finished turn whose work holds only finished steps, answered cards and words folds behind its Worked row, the narration with it (`foldedRows` in `turns-of.ts`), so what Haiku writes between calls is read only by someone who opens the fold.

**What might resolve it.** Not prompt text, which three wordings have now failed to move. What the product does with the words: keeping text written beside a tool call in the fold while the turn is still running, so only the first line and the outcome stand in the transcript, whatever the model writes.
