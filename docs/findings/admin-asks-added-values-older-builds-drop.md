# Admin asks added values that older builds drop

**Status:** open, checked 2026-11-28. Shipped in v2.1.0-beta.7, so it can't be taken back. An older build on another computer shows no card for an admin ask and drops the answers given to it. The ask runs only on the computer that asked, so nothing runs wrongly; the cost is what an older build shows.

## What happened

[Changing the format](../architecture/chat-records.md#changing-the-format) says that outside a data part, a new value is never added to an existing enum, an ask's `on` among them, since an older build drops the whole line. Asking to run a command as an administrator (6377b0482, d0611409e) added three:

- `on: "admin"` on a permission ask (`PermissionOnSchema` in `schemas/session/message-data-part.ts`).
- `admin-prompt` as a system wait (`SystemWaitSchema` in `schemas/ask.ts`), written as the ask's `stage.on` while the system's password prompt is up.
- `without-admin` and `ran-by-hand` as permission decisions (`PermissionDecisionSchema`), in `answer` records.

## What an older build does

A build from before v2.1.0-beta.7 fails to parse each of those lines and skips it:

- Every write of an admin ask, so the chat shows no card for it there and doesn't read as waiting.
- An answer of Try without administrator or I ran it myself, given anywhere. It can't take one anyway, since only the asking computer acts on an admin ask.

Folder, app and page asks are unchanged, so nothing else in the chat is lost.

## What might resolve it

Nothing to undo: older builds age out as people update. The rule held in review only by being read. A test pinning the values of each enum the record schemas use outside data parts would make the next addition fail until it is made a new field instead.
