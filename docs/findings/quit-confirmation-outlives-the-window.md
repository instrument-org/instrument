# A quit confirmation must run before the window is destroyed on Windows/Linux

**Status:** resolved — guidance for anything that gates or delays a quit. Recorded 2026-07-25.

## Symptom

On Windows (and by the same mechanics, Linux): with an agent running, clicking the window's close button destroyed the window, _then_ raised the "agents are still running" dialog. Choosing Cancel left a live process with no window, no dock icon, and no menu bar. Relaunching the app did nothing, because the stranded process still held the single-instance lock. The only exit was Task Manager.

Exception reporting also showed the second launch failing outright:

```
TypeError: Object has been destroyed
  app.on("second-instance") -> focusForegroundWindow -> mainWindow?.isVisible()
```

## Why it happened

The confirmation was hooked to `before-quit` only, which on macOS is where a quit starts (Cmd+Q). Outside macOS the sequence is different, and the window is already gone by the time `before-quit` runs:

```
close button -> window `close` (not prevented) -> window destroyed -> `closed`
  -> `window-all-closed` -> app.quit() -> `before-quit` -> dialog
```

Two things compounded it:

- The window singleton was never cleared on `closed`, so `getMainWindow()` handed out a destroyed `BrowserWindow`. Every method on one throws `Object has been destroyed`, which killed the `second-instance` handler — the one path that could have brought the app back.
- `app.quit()` is not the only entry to `before-quit`, but `before-quit` _is_ the only place the app looked, so nothing guarded the close itself.

## Guidance

- **Ask on `close`, not just `before-quit`, on Windows/Linux.** `event.preventDefault()` in the window's `close` handler, await the answer, then close for real. macOS is the exception, not the template: there the app outlives its window, so closing interrupts nothing and only Cmd+Q needs to ask.
- **Latch the answer for one quit.** A confirmed close travels `close` → `window-all-closed` → `before-quit`; without a shared latch the user is asked twice (`electron-main/lib/quit-guard.ts`).
- **Never leave a non-macOS process without a window.** There is no dock or menu bar to reopen from, and the single-instance lock turns a fresh launch into a no-op. Any path that can cancel a quit has to put a window back, and `second-instance` must be able to create one rather than assuming one exists.
- **Treat window handles as expiring.** Clear the singleton on `closed` and report destroyed windows as absent, so callers get `null` instead of an object that throws on every method.
- **Fail open in quit prompts.** A prompt that errors must not abort the quit half-done; that is how a process ends up alive but unreachable.
- **Nothing hooked to `will-quit` runs here.** The teardown ends in `app.exit`, which by design emits neither `before-quit` nor `will-quit`. Shutdown work has to be called from the teardown itself; hanging it on the event is why the crash marker was never cleared and every launch reported the previous session as a crash (`finalizeTelemetry`).
