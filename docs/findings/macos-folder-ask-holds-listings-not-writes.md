# The macOS folder ask holds a listing and a read, not a write

**Status:** observed on macOS 27 with installed signed builds, first with a beta and since with a preview probed as the app itself (its binary run as Node from a launchd job, so its own privacy grants apply). The mechanism inside macOS is not established; the behavior is. The app works with it in `lib/permissions/macos.ts`.

## What macOS does

While Instrument has never been asked about a folder macOS guards (Desktop, Documents, Downloads, iCloud Drive, a disk under `/Volumes`):

- `stat` of the folder or of a file in it answers at once, before and after the person's answer, whatever it is.
- Creating a new file in it succeeds at once, while the prompt is still up. A denial afterwards does not undo it.
- Listing the folder (`opendir`, `readdir`, `ls`), and reading an existing file in it by its path, both wait for the person's answer and settle the moment they give it: Allow lets them through, Don't Allow fails them with `EPERM` there and then.

After a denial, listings and reads fail with `EPERM` at once, and nothing asks again; only the folder panel (a pick sets `com.apple.macl`, which lasts across relaunches) or System Settings lets the app back in.

While one prompt is up, a listing of the same folder by any of the app's processes waits too, a bystander included, and a listing of a second guarded folder waits in line and gets its own prompt once the first is answered. A listing of a folder macOS does not guard answers at once. A wait holds one of Node's file threads but not the JS thread.

The prompt is a window owned by `UserNotificationCenter`, and so are the prompts for Automation (another app's Apple Events) and for Reminders and Calendar. Its owner is readable from the window list without Screen Recording permission, so "macOS is asking" is told by that window being on screen while a look into a guarded folder waits, never by how long the look takes: a slow disk or an iCloud folder still downloading waits too.

## Where the app uses this

- `listFolder` (`lib/chat/folder-look.ts`) and `lookAsTheApp` (`lib/permissions/macos.ts`) look inside a folder as the app: an Allow on a folder card runs one, and so does `ask_permission` for a folder the rules already allow.
- `watchMacosPrompt` and `watchForMacosAsking` watch for the prompt's window only while such a look waits, and raise the chat's "Your Mac is asking" card when it shows. The card settles on the look's answer: open closes it, `EPERM` turns it into the refused card.
- A refusal counts as macOS's only when a look at the containing folder is refused too (`rules-fs.ts`), since a file's own flags or owner fail with `EPERM` as well.
