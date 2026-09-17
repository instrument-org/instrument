# The inbox: the 2.0 chat pane shaped like mail, with each thread's tabs

Status: built, first version. The inbox rows in two densities, the sections column, the topic banner, the draft window with its attachments as tabs, the tab groups scoped to threads, the right-area close, and the tasks badge are in. Still to come from the sections below: the groups kept in the workspace rather than on one computer, sites and folders gathered into a draft, the Drafts and Archive places holding something, and the word on the draft's action.

## The rule

Mail is the metaphor and the furniture is ours. A thread is a conversation the user started; the inbox lists them by when anything last happened, newest at the top, so a reply landing lifts its thread. What the agent opened or made while working in a thread stays with that thread: its tabs, its files, its sites. Nothing lives at the window level except the way in (New), the way out of the right area, and the count of tasks at work. The words on screen are ours: Inbox, Unread, Drafts, Archive, Topics, Apps; never Compose, Label, Attachment, Mail.

## The pane

The sections column at the left: New across the top in the brand's green; then the places Inbox (every thread, with how many), Unread (with how many), Drafts, and Archive; then Topics as rows with their marks and counts, with a plus on the head; then Apps as rows. The column is one radio group: choosing a row is standing in it, choosing it again steps back out to the inbox. Below thirty rem of pane it shrinks to a strip of marks in the same order. The search sits over the list, the way mail puts it, and narrows whatever the column has chosen.

The rows take one of two shapes from the list's own width, measured rather than told. Past six hundred pixels a row is one line, mail style: the state dot in a gutter (brand while the thread works or holds replies not yet seen, amber while it waits on the user, nothing while quiet), one topic pill, the title in a fixed column (semibold while something is unseen), the agent's latest line in muted (the running step in brand, a question behind an amber glyph with gray words), the holds as marks (files as chips with their names, apps and sites as bare marks), and when anything last happened at the far right (the clock today, the weekday within six days, then the date). Under that width a row is three lines: the pill, the title with the reply count right after it from two replies up and the time at the line's end; the latest line clamped to two; the holds. The typed ask is not on the row; the title stands for it until the agent names the thread.

With one topic chosen, a banner stands above the rows: the topic's mark and name, its line about itself or how much is filed there since when, and a strip of what its threads hold.

## The draft

New opens a draft at the bottom right of the window rather than a field under the list. Its head is a slim row with minimize, expand, and close; its body has the topic slot at the top left and the round brand arrow at the top right, the words as the head of it, and under the words everything gathered so far as a row of tabs, the one that is up shown in full beneath them, the way the thread's tabs will show it. A file dropped anywhere on the draft lands as a tab and comes up; the window grows tall for it. Minimize leaves a bar along the bottom edge; expand opens the same body in a modal over the whole window, as large as the window allows, since a draft is apart from what is open. The draft is one in-memory record wherever it is drawn, and it survives the right area being put away. The arrow starts the thread with the words, the files, and the topic; the thread's group comes up seeded with a tab per gathered file, and then the thread itself is shown. The arrow has no word on it: the right one for starting a thread is still to be found, and Send is not it.

## Each thread's tabs

The tabs belong to threads. Each thread has a group with the thread's own screen as its anchor, first in the row and never closed. Whatever opens while the thread is on screen joins the group as a new tab, never in place of what the right area had up: a page or file the agent hands over, a link or card the user clicks, a task's browser filed from that thread. Choosing another thread swaps the whole row; coming back lands on the tab the thread last had up, and asking for the thread while it is already up lands on the thread itself. What opens outside any thread stays in the window's own group. Sending a thread's screen elsewhere opens a tab beside it rather than moving it. The tab row sits at the top of the right area over the location row; the window bar's middle is empty, reserved for tabs of the window's own should they come back. A hold on an inbox row opens its thread and then the hold as a tab of the thread's.

The groups are one flat list of tabs, each carrying the thread it belongs to, kept on this computer across launches. Keeping them in the workspace, the way a task's open tabs were kept before, is the next step.

## The bar

The window bar keeps three things at its right end. The tasks badge says how many tasks are at work or waiting and opens the list of them, the active ones first and then the ones lately settled; a task pressed opens its thread and then the task as a tab of the thread's, and the list never takes the right area. The right-area control puts the whole right area away in one press, so leaving a thread is not closing its tabs one by one; the inbox takes the width, the tabs keep what they have, and opening anything brings the area back. Activity's door left the bar; the screen stays reachable by address and from the new-tab page.

## Accepted for this version

- Inbox carries the total count and Unread the unread count, rather than an unread count on both.
- The reply count after a tall row's title shows only from two replies up.
- Drafts and Archive are rows so the concepts are in view; neither holds anything yet.
- The draft gathers files only; a file read in from bytes rather than pointed at on disk goes with the message but cannot become a tab, since a tab needs a place to open.
- The modal keeps the draft's body rather than a larger one.
- No microphone on the draft, since the app has no dictation.

## Open

- The tab groups kept in the workspace rather than in browser storage on one computer.
- Sites and folders gathered into a draft, with a page shown inside it.
- What the Drafts and Archive places hold, and how a thread is put away.
- The word on the draft's action.
- The new-tab page's Activity door, and whether Activity stays at all.
