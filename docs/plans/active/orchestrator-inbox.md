# The inbox: the 2.0 chat pane shaped like mail, with each thread's tabs

Status: built, second version. The draft is a tab group of its own docked in the right area, the agent's opens land with the thread that asked, the threads stay mounted, archiving and starring work with undo, and the inbox rows carry their actions. Still to come from the sections below: the groups and drafts kept in the workspace rather than on one computer, and the word on the draft's action.

## The rule

Mail is the metaphor and the furniture is ours. A thread is a conversation the user started; the inbox lists them by when anything last happened, newest at the top, so a reply landing lifts its thread. What the agent opened or made while working in a thread stays with that thread: its tabs, its files, its sites. Nothing lives at the window level except the way in (New), the way out of the right area, and the count of tasks at work. The words on screen are ours: Inbox, Unread, Needs you, Starred, Drafts, Archive, Topics, Apps; never Compose, Label, Attachment, Mail.

## The pane

The sections column at the left: New across the top in the brand's green; then the places Inbox (every thread not put away, with how many), Unread, Needs you, Starred, Drafts, and Archive, each with how many; then Topics as rows with their marks and counts, with a plus on the head; then Apps as rows. The column is one radio group: choosing a row is standing in it, choosing it again steps back out to the inbox. Below thirty rem of pane it shrinks to a strip of marks in the same order. The search sits over the list, the way mail puts it, and narrows whatever the column has chosen.

The rows take one of two shapes from the list's own width, measured rather than told. Past six hundred pixels a row is one line, mail style: the state dot in a gutter (brand while the thread works or holds replies not yet seen, amber while it waits on the user, nothing while quiet), one topic pill, the title in a fixed column (semibold while something is unseen), the agent's latest line in muted (the running step in brand, a question behind an amber glyph with gray words), the holds as marks (files as chips with their names, apps and sites as bare marks), and when anything last happened at the far right (the clock today, the weekday within six days, then the date). Under that width a row is three lines: the pill, the title, and the time at the line's end with the reply count under it; the latest line clamped to two; the holds on one line, files first, clipped at the edge. The typed ask is not on the row; the title stands for it until the agent names the thread.

With one topic chosen, a banner stands above the rows: the topic's mark and name, its line about itself or how much is filed there since when, and a strip of what its threads hold.

## The draft

New at the top of the sections column starts a draft, which is a tab group of its own: while it is up the right area shows it, with the draft's words as the head over its tab row (the topic slot at the top left, the round brand arrow at the top right, the words under them, and the files read in from bytes as tiles beside them) and, under the row, whatever the tab up shows. Its home is the new-tab page, first in the row and never closed, so a site, a folder, a file, an app, or an idea opened from there is a real tab of the draft's. A file dropped on the head that has a place on disk opens as a tab too. Expanding puts the inbox away so the draft has the window; minimizing leaves a bar along the bottom edge and hands the screen back to the group the draft took it from; closing keeps a draft with words or tabs in Drafts and throws an empty one away. The arrow starts the thread with the words, the files, and the topic, and what the draft's tabs show as the context; then the group is re-keyed to the thread with the thread's own screen put first, so the tabs, guests and all, are the thread's exactly as they were. The arrow has no word on it: the right one for starting a thread is still to be found, and Send is not it.

Drafts are rows in the Drafts place, newest first, opened by a click and thrown away from the row. They live in an atom kept on this computer, as the tabs do.

## Each thread's tabs

The tabs belong to threads. Each thread has a group with the thread's own screen as its anchor, first in the row as a fixed "Thread" tab and never closed. Whatever opens while the thread is on screen joins the group as a new tab, never in place of what the right area had up: a page or file the agent hands over, a link or card the user clicks, a task's browser filed from that thread. The agent's opens carry the thread that asked, so a page or path opened for a thread that is not up lands in that thread's group behind, made with its anchor if the thread has not been shown yet. Choosing another thread swaps the whole row silently; coming back lands on the tab the thread last had up, and asking for the thread while it is already up lands on the thread itself. A file or page asked for as a tab of its own comes forward if the group already has it. Sending a thread's screen elsewhere opens a tab beside it rather than moving it. The tab row sits at the top of the right area; a thread's own tab wears a head (topic, title, count, time) in place of the address row. A hold on an inbox row opens its thread and then the hold as a tab of the thread's.

There is no group of the window's own: nothing on screen means the right area is closed and the inbox takes the width, so the tabs can never stand without a thread or a draft. The threads lately shown stay mounted behind the one on screen, so switching back is the transcript as it was.

The groups are one flat list of tabs, each carrying its group, kept on this computer across launches. Keeping them in the workspace, the way a task's open tabs were kept before, is the next step.

## Rows and places

A row carries its actions over the time while the pointer is on it (Archive or Unarchive, Mark as read or unread, Star or Unstar) and a menu on a right click with the ways in, the actions, and the topics. Archiving and unarchiving each show a toast with an undo. Starring is a control in view on a wide row and a mark once given on a narrow one. The places are Inbox, Unread, Needs you (a thread waiting on the user, including a task of its stalled on a question), Starred, Drafts, and Archive; a thread put away is in the archive alone, a starred one in Starred wherever it is.

## The bar

The window bar keeps three things at its right end. The tasks badge says how many tasks are at work or waiting and opens the list of them, the active ones first and then the ones lately settled; a task pressed opens its thread and then the task as a tab of the thread's, and the list never takes the right area. The right-area control puts the whole right area away in one press, so leaving a thread is not closing its tabs one by one; the inbox takes the width, the tabs keep what they have, and opening anything brings the area back. Activity's door left the bar; the screen stays reachable by address and from the new-tab page.

## Accepted for this version

- Inbox carries the total count and Unread the unread count, rather than an unread count on both.
- The reply count is the chat mark and a number, under the time on a narrow row and before it on a wide one, from two replies up.
- The draft gathers files by path as tabs; a file read in from bytes rides with the words as a tile.
- The bar is where a minimized draft waits; expanding hides the inbox rather than opening a modal, since the right area is the draft.
- The tasks badge counts running and waiting tasks together.
- No microphone on the draft, since the app has no dictation.

## Open

- The tab groups and the drafts kept in the workspace rather than in browser storage on one computer.
- The word on the draft's action.
- The new-tab page's Activity door, and whether Activity stays at all.
