# The inbox: the 2.0 chat pane shaped like mail, with each thread's tabs

Status: built, third version. A thread stands beside its tabs the way a task's page keeps its pane, headed like one; a draft takes the same column with the new-task page's prompt box; the inbox column collapses; the agent's opens land with the thread that asked; the threads stay mounted; archiving and starring work with undo; the inbox rows carry their actions. Still to come from the sections below: the groups and drafts kept in the workspace rather than on one computer, a rename for a thread, and the word on the draft's action.

## The rule

Mail is the metaphor and the furniture is ours. A thread is a conversation the user started; the inbox lists them by when anything last happened, newest at the top, so a reply landing lifts its thread. What the agent opened or made while working in a thread stays with that thread: its tabs, its files, its sites. Nothing lives at the window level except the way in (New), the inbox column's toggle, and the count of tasks at work. The words on screen are ours: Inbox, Unread, Needs you, Starred, Drafts, Archive, Topics, Apps; never Compose, Label, Attachment, Mail.

## The pane

The sections column at the left: New across the top in the brand's green; then the places Inbox (every thread not put away, with how many), Unread, Needs you, Starred, Drafts, and Archive, each with how many; then Topics as rows with their marks and counts, with a plus on the head; then Apps as rows. The column is one radio group: choosing a row is standing in it, choosing it again steps back out to the inbox. Below thirty rem of pane it shrinks to a strip of marks in the same order. The search sits over the list, the way mail puts it, and narrows whatever the column has chosen.

The rows take one of two shapes from the list's own width, measured rather than told. Past six hundred pixels a row is one line, mail style: the state dot in a gutter (brand while the thread works or holds replies not yet seen, amber while it waits on the user, nothing while quiet), one topic pill, the title in a fixed column (semibold while something is unseen), the agent's latest line in muted (the running step in brand, a question behind an amber glyph with gray words), the holds as marks (files as chips with their names, apps and sites as bare marks), and when anything last happened at the far right (the clock today, the weekday within six days, then the date). Under that width a row is three lines: the pill, the title, and the time at the line's end with the reply count under it; the latest line clamped to two; the holds on one line, files first, clipped at the edge. The typed ask is not on the row; the title stands for it until the agent names the thread.

With one topic chosen, a banner stands above the rows: the topic's mark and name, its line about itself or how much is filed there since when, and a strip of what its threads hold.

## The draft

New at the top of the sections column starts a draft, which takes the conversation column: a head naming it, with the pane toggle and the way out, and under that the prompt box the new-task page starts a task from, its rounding, plus menu, model picker and arrow, with the topic the thread will be filed under as the chip at its head. Beside the model sits the output picker: a quiet chip saying Output until a page type is picked, then that type's own pictogram and name; it opens the whole catalog of page types in a popover under itself, four across in the catalog's groups, scrolling down, one picked at a time and cleared by the same tile or by Clear. Nothing is picked to begin with, and the arrow never changes. The pick goes with the first message as its output-format part, which the agent reads as the brief's page type and the record shows as a line under the ask. Its tabs are the pane's, beside it, starting with the new-tab page, so a site, a folder, a file, an app, or an idea opened from there is a real tab of the draft's; a draft never runs out of tabs, since closing its last one puts the new-tab page back. The words ride in the draft's record so the Drafts list can name it and a relaunch keeps them; what else the box was given (files, a folder) is kept in memory while the draft is away and put back when it comes up. Closing keeps a draft with words or something gathered in Drafts and throws an empty one away. The arrow starts the thread with what the box sends, the topic, and what the pane's tab shows as the context; then the group is re-keyed to the thread and the thread's conversation takes the column, so the tabs, guests and all, stay exactly where they were. The arrow has no word on it: the right one for starting a thread is still to be found, and Send is not it.

Drafts are rows in the Drafts place, newest first, opened by a click and thrown away from the row. They live in an atom kept on this computer, as the tabs do.

## A thread and its pane

A thread on screen takes the conversation column, headed the way a task's page heads its chat: the topic pill and the title with the thread's own menu hugging them (archive, mark read, star, topics, close), and at the right the pane toggle while the pane is closed and the way out of the thread. The transcript reads as messages, each reply in a bubble at the left facing the user's at the right, with the reply field at the bottom. The threads lately shown stay mounted behind the one on screen, so switching back is the transcript as it was.

The tabs belong to threads and sit in a pane beside the conversation, the way a task's page keeps its pane: a card with the tab strip as its first row and the pane toggle at the strip's end, on the same pixel the head keeps it while the pane is closed, so pressing it again and again never moves the pointer; the address row under the strip; the edge between conversation and pane dragged to size them, and past its floor closes the pane. Each group's pane state is its own. Whatever opens while the thread is on screen joins its group as a new tab and brings the pane up; the agent's opens carry the thread that asked, so a page or path opened for a thread that is not up lands in that thread's group behind. A group may hold no tabs: closing the last one closes the pane, and the toggle brings it back with a new tab in it. Choosing another thread swaps the whole row silently, and coming back lands on the tab the thread last had up. A hold on an inbox row opens its thread at the hold, as a tab of the thread's, with the pane up.

There is no group of the window's own: nothing on screen means the inbox takes the width. The groups are one flat list of tabs, each carrying its group, kept on this computer across launches. Keeping them in the workspace, the way a task's open tabs were kept before, is the next step.

## Rows and places

A row carries its actions over the time while the pointer is on it (Archive or Unarchive, Mark as read or unread, Star or Unstar) and a menu on a right click with the ways in, the actions, and the topics. Archiving and unarchiving each show a toast with an undo. Starring is a control in view on a wide row and a mark once given on a narrow one. The places are Inbox, Unread, Needs you (a thread waiting on the user, including a task of its stalled on a question), Starred, Drafts, and Archive; a thread put away is in the archive alone, a starred one in Starred wherever it is.

## The bar

The window bar keeps two things. At its left, past the lights, the inbox toggle puts the inbox column away so a thread and its tabs have the window, and brings it back; closing the thread brings it back too, since nothing else would be left on screen. At its right, the tasks badge says how many tasks are at work or waiting and opens the list of them, the active ones first and then the ones lately settled; a task pressed opens its thread and then the task as a tab of the thread's. Activity's door left the bar; the screen stays reachable by address and from the new-tab page.

## Accepted for this version

- Inbox carries the total count and Unread the unread count, rather than an unread count on both.
- The reply count is the chat mark and a number, under the time on a narrow row and before it on a wide one, from two replies up.
- The draft's files and folders are the prompt box's own, sent with the first message the way the new-task page sends them.
- A draft is never minimized: it is closed, and comes back from Drafts.
- The tasks badge counts running and waiting tasks together.
- The transcript's assistant text sits in bubbles, reversing the rows-not-bubbles rule of the Slack-shaped round, because the conversation column is narrow beside the pane.
- The conversation's prompt no longer makes every long answer a page: a page is one of the forms a file takes, chosen by the picker, the user's words, or the work itself.
- The new-tab page has no Ideas section; the Ideas screen stays.
- No microphone on the draft, since the app has no dictation.

## Open

- The tab groups and the drafts kept in the workspace rather than in browser storage on one computer.
- The word on the draft's action.
- Renaming a thread from its head, which needs a route the workspace has not got.
- The new-tab page's Activity door, and whether Activity stays at all.
