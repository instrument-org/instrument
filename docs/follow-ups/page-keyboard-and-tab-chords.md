# Whether a page off screen still takes the keyboard

**Status:** open · **Check after:** 2026-12-04

## What we're waiting to learn

A page whose tab group left the screen kept the keyboard: `main.log` showed keys reaching a guest that had been asleep for half a minute, and Shift+Cmd+[ did nothing until the person clicked into the page on screen. Two changes answer it. The renderer pool hands the keyboard back from a parked page once a slot move would have settled, and as main puts a parked page to sleep. Main runs the tab-switch chords from a page's own key handler, so they work wherever the keyboard is. Log lines added with them say whether a page off screen still takes the keyboard, and so whether the pool's hand-back has a gap left.

## The signal

In a 2.1 beta's `main.log` (`BrowserViewManager` scope):

- `tab chord from page ... shown=false`: a tab chord reached a page no slot shows, so the keyboard was in a page off screen. The chord ran anyway; the hand-back missed a path.
- `page keyboard taken ... shown=false` or `asleep=true`: a page off screen took the keyboard.
- `guest shown` and `guest parked` lines name each page by scheme, host and file extension (`page=file://.png`), so a target id in the lines above can be matched to what it showed.

## Where to look

`~/Library/Application Support/Instrument/logs/main.log` on a computer running a beta with these lines, or the log a problem report attaches.

## What each answer means

- **No `shown=false` lines over a couple of weeks of use:** the hand-back covers it. Drop `page keyboard` and `tab chord from page` lines if they are noise, and close this.
- **`shown=false` lines:** read the `guest parked` and `page keyboard taken` lines just before, to find what put the keyboard in a page off screen, and close that path in `browser-pool.ts`.

## What comes out once the cause is found

The pool's two hand-backs are a backstop, not the cause: the look again after `SLOT_MOVE_SETTLE_MS` in `releaseGuestFocus`, and the hand-back as a parked page goes to sleep in `reconcile`. The suspected cause is the keyboard side still naming the page in the microtask after it parks, while its tab group leaves the screen. Once the path that leaves the keyboard in a page off screen is closed where it starts, remove both. The tab-switch chords run from a page's key handler stay: Chrome keeps those chords from pages too.
