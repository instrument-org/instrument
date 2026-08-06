# What actually marks a Studio renderer hidden, and what does not

**Status:** resolved — guidance for anything gating work on `document.hidden`. Recorded 2026-08-06.

## Symptom

A relative-timestamp component paused its timers on `visibilitychange` → hidden and rebuilt them on the paired `visible`. Reading [the comment in `routes/_app/projects/$id/index.tsx`](../../apps/studio/src/client/routes/_app/projects/$id/index.tsx) — "Electron does not fire [visibilitychange] when the OS window regains focus (the view is never marked hidden)" — that looked like a broken event pair worth defending against, and it grew a `window.focus` fallback and a 60s watchdog poll to guarantee the pause could always be undone.

The premise was wrong, and the machinery guarded a failure mode that cannot happen.

## What drives visibility

Electron marks the web contents hidden from exactly two overrides in `shell/browser/api/electron_api_browser_window.cc`:

```cpp
void BrowserWindow::OnWindowShow() {
  if (!web_contents_shown_) { web_contents()->WasShown(); web_contents_shown_ = true; }
  BaseWindow::OnWindowShow();
}
void BrowserWindow::OnWindowHide() {
  web_contents()->WasOccluded();
  web_contents_shown_ = false;
  BaseWindow::OnWindowHide();
}
```

On macOS both sides are reached from one `NSWindowDelegate` callback in `shell/browser/ui/cocoa/electron_ns_window_delegate.mm`, as a single if/else on the occlusion flag:

```objc
- (void)windowDidChangeOcclusionState:(NSNotification*)notification {
  ...
  if (window.occlusionState & NSWindowOcclusionStateVisible) { shell_->NotifyWindowShow(); }
  else { shell_->NotifyWindowHide(); }
}
```

So hide and show are **the same code path taking opposite branches**. There is no arrangement where the hidden edge is delivered and the visible edge is dropped, which is what the watchdog was insuring against.

Three consequences that are easy to get backwards:

- **Losing OS focus does not mark the view hidden.** No `visibilitychange` fires at all for focus changes — not a missed event, a transition that never happens. Code that wants "the user came back to the app" must listen to `window` `focus`; that is the whole reason the projects route pairs the two, and it is not evidence about hide/show.
- **`BrowserWindow` does not override `OnWindowMinimize` / `OnWindowRestore`.** Those only emit their JS events. Minimizing reaches visibility indirectly, through the platform's own occlusion or hide notification, not through a minimize handler.
- **The main window is created `show: false`** (`electron-main/windows/main/index.ts`), so the renderer's first paints run with `document.hidden` true and the first `visibilitychange` a module sees may be its *initial* transition to visible. Anything that only starts working on a visibility event will not have started during boot.

## Guidance

- Trust `visibilitychange` for hide/show. Everything in the renderer that gates on visibility does exactly this and nothing more: `components/updated-toast.tsx`, `hooks/use-clear-task-indicator-on-view.ts`. Add `window` `focus` alongside it **only** when you need focus-return, which visibility genuinely never reports.
- Do not hand-roll a pause for background work. `backgroundThrottling` is left at its default for the main window, so Chromium already clamps a hidden window's timers. A hand-rolled pause saves little on top of that and converts a self-correcting situation into one that depends on an event to undo it.
- Do prefer a resync on return. Throttling means the wall clock can move much further than the last tick observed, so re-reading it when the window comes back is what keeps the first frame current. That is a read, not a state machine, and it cannot wedge.
- No watchdog polls. There are none in the renderer, and this is not the case that earns the first.
