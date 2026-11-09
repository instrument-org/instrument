# Haiku narrates between tool calls, and prompt wording does not move it

The agent's prompt says work over several calls gets one line at the start and the outcome at the end, with nothing between. Claude Haiku 5.5 writes between calls anyway, in about half of its multi-call stretches; GPT-6.1 Sol almost never does.

**What was seen.** Counted over eval records and real chats, a stretch being an assistant's calls between two user messages, with a task's wake starting a new one so a reply to a finished task does not count: Haiku 5.5 wrote between calls in 46% of chat stretches and 53% of task stretches; GPT-6.1 Sol in 4% and 0%; Grok 4.7 in nearly all, on a small sample. Haiku's lines are running bookkeeping ("Page 1 is in the cart at $7.36. Moving to page 2."), restating what each call's `activity` and `explanation` already show, and a few real asks a permission card already makes.

**What was tried.** A stronger rule (write nothing between calls, neither what you found nor what you will do next, since the steps fold behind one line; words only to say you are stopping or to answer something asked mid-work), scored on Haiku 5.5 with `tab-lock-two-tasks` and `tab-lock-quick-check`, three repeats each on the old and new prompt. Lines between calls went from 36 to 34 in the chat and 12 to 9 in tasks, within noise, so it was not kept. Simple file jobs (renaming a folder's files, totaling CSVs) drew no narration on either prompt, so they cannot show a change: browser and task work is where it appears.

**Why it matters less now.** A finished turn whose work holds only finished steps, answered cards and words folds behind its Worked row, the narration with it (`foldedRows` in `turns-of.ts`), so what Haiku writes between calls is read only by someone who opens the fold.

**What might resolve it.** Pointing the habit somewhere it belongs instead of forbidding it: the call's `explanation`, which the person already reads as the step's label. Untested.
