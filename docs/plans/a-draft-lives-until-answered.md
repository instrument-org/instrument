# Plan: a draft lives until its message is answered

Status: done.

A sent draft is removed the moment its message is written: the message route copies what the draft's folder had into the chat's `attachments/`, takes it out of the folder (`removeSentFromDraft`), and the window's `sent` op removes the draft. Everything that wants the message back before the agent has answered it (Stop taking back an unanswered message, a first message turning its chat back into a new chat) then has to rebuild a draft from the chat's records: its words from the message, its files from the attachments (copied back out where the chat kept its own copy), its asks and chips from the message's parts, its project from the chat. That rebuild is most of the code take-back needs, and it can never be exact.

This plan keeps the draft, folder and all, until its message is answered or taken back. Taking a message back is then putting the draft back.

## The lifecycle

A draft's send is one property with one stage at a time, in place of the separate fields that each say part of it today (`sendOn`, `sendingTo`):

| Stage | Means | Shown as |
| --- | --- | --- |
| none | being written | a new chat in its tab, a reply in its chat's box, a row in Drafts |
| `asked` (device) | another device asked this one to send it (`send:` in the file) | as today |
| `sending` (chat) | claimed, the message not yet written (`sending:` in the file) | nowhere: it is the message about to arrive |
| `sent` (chat, message) | the message is written and not yet answered (`sent:` in the file) | nowhere: the chat shows the message |

From `sent` it goes one of two ways:

- **Answered**: the turn that the message started ends with the message still in the chat (not retracted). The draft is finished as `sent` finishes it today: what was sent is removed from its folder, whatever arrived after the send read the folder goes to the Trash, and the id is refused for the rest of the run.
- **Taken back**: Stop retracted the message before any answer (`unansweredMessage`). The draft goes back to no stage, exactly as it was before the press, folder included. A reply goes back into its chat's box, or waits beside it when the box has words of its own. A chat's first message turns its tab back to `/chats?draft=<id>`, and the chat, left with nothing, goes to the trash as Delete sends it.

A send that fails before the message is written is released as today.

## One rule for finishing, wherever it runs

A draft in `sent` is finished when its message is still in its chat and the turn it started is over; it is released when its message was retracted. The turn's end in main applies the rule for a send from any window and for one another device asked for (`send-asked-drafts.ts`). A launch applies the same rule (`finishSentDrafts`), so a crash anywhere in between ends in the same state: a retracted message's draft comes back to the person, an unretracted one is finished. A crash between the retract record and the release is covered by that.

A draft left in `sent` while the app is killed mid-turn is hidden until the next launch finishes it, and the chat already has its copy of every file, so nothing is lost; at worst the draft's folder outlives the send by one launch.

## What this removes

- From take-back: `takenBackOf` and the `TakenBack` payload rebuilt from records (words, files resolved to paths, folders, chips, asks). The stop route answers with the retracted message's `fromDraft`, and the window releases that draft.
- From the first-message take-back: building a new-chat draft from a `TakenBack`, copying the chat's own copies of files out before trashing it (`copyIn`, `inChat`), and the stage request union.
- Every send of the person's goes through a draft (`fromDraft`), so take-back has one path. A send with no draft behind it, if any is left, gets one.

## On disk

The file keeps `send:` and `sending:` as they are, and a draft in `sent` writes `sent:` naming its chat and message, so another device and the phone app leave it alone and a launch knows where to look. A draft whose file has `sending:` and whose chat has its message reads as `sent`, which is what a file from a build before this one looks like.

## Later, on the same property

A message queued behind a running turn is a draft in a stage of its own on its chat, sent when the turn ends; a draft list that shows what is on its way reads the same property. Neither is part of this plan.

## As built

- The stage is `send` on a draft (`DraftSend` in `shared/drafts.ts`). A `sent` draft writes `sent:` beside `sending:` rather than in place of it, so a build or a phone that knows only `sending:` leaves it alone.
- The message route marks the draft `sent` through a host hook (`draftSent` in `WorkspaceConfig`) before the message's turn starts, so a turn that errors at once cannot end ahead of it.
- The turn's end is `session.done`, which `turnEnds` (`lib/host-events.ts`) hands main; `electron-main/drafts/finish-answered-drafts.ts` settles the drafts sent into the chat. Stop with take-back sets `takesBack` on its notice, so the finisher leaves the unanswered message's draft to the take-back, whose retract would otherwise land after `session.done`.
- What the send took from the folder is kept in memory only, so a draft finished by a launch moves everything its folder still has to the Trash; the chat has its own copy of each file.
- A first message's chat is trashed by the window that took it back. When a crash cuts that take-back short, the launch releases the draft as the new chat's draft it was, and the chat, empty, is left in place.
- Sends with no draft behind them, which Stop cannot take back: Retry, the suggested next message, "Continue.", and a message a settings, memory or skills screen asks a chat to send (`appWindow.ask`).
