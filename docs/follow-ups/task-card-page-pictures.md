# Whether a task's page card still shows only the site's icon

**Status:** open · **Check after:** 2026-11-22, after a week on a beta carrying the fix below · **Last checked:** never

## What we're waiting to learn

A packaged beta showed a task's live page card as the site's icon on an empty ground for the whole time the task drove a page the person had handed it, with the chat popped out. The main process had taken the picture: the page's thumbnail file was written a second after the task's first command. So the picture was lost between the main process answering and the card, in a renderer that drops a finished capture whenever a newer one was asked for meanwhile, and lets the card's first read of the kept picture overwrite one taken while that read was on its way. A clean-room reproduction on macOS never showed the bare icon, so which of those it was is not settled. The commit that adds this note makes the renderer show any capture newer than the one shown, asks again while none could be taken, takes a picture as soon as the guest is ready, keeps the window drawing while the main process takes one, and logs every capture the main process could not take.

## The signal

- Main-process lines `page picture not taken key=<tab id> reason=<why>`, scoped `BrowserViewManager`. `No frame within 3000ms` means the guest drew nothing in time: asleep a long while (its page draws nothing until a command wakes it), or a page that had just started loading. A few around a task's first command or a page load are expected; a run of them for one tab while the card is up and the tab is being driven is the bug still there, in the main process.
- A person seeing the bare icon on a card while the tab's thumbnail file in the browser folder's `page-thumbnails` has a recent time and none of the lines above for that tab: the renderer still loses captures; read which tab the card picked (`useDrivenTab` in `live-surface.tsx`), since that is the remaining suspect.
- Neither, over a week of tasks on pages: closed as fixed.

## Where to look

The main-process logs and the browser folder's `page-thumbnails` of beta machines that ran tasks on pages the person handed over, macOS first.

## What each answer means

- **No bare cards, few failures:** close it.
- **Bare cards with failures for the driven tab:** capture timing for a page that just woke or loaded; wake the guest for the picture, or wait for its first frame, in `page-thumbnails.ts`.
- **Bare cards with the thumbnail written and no failures:** the card picked a tab other than the driven one; the tab choice reads a one-shot `chats.state` and needs a live source of which tabs a session drives.

## Result

Not yet checked.
