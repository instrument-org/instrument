# Dragging a file out does not cross from XWayland to Wayland

**Status:** fixed. Reproduced by hand on Ubuntu 24.04.4 with GNOME Shell 46 in a Wayland session, against a shipped beta, 2026-08-28. The cause was the `--ozone-platform=x11` pin, not our drag code. The pin came off in 1.6.6, but its replacement asked Chromium to choose by leaving the switch off, which selects X11 rather than reading the session: 1.6.6 and 1.6.7 therefore ran on XWayland while logging otherwise, and the drag stayed broken for everyone who did not set the override by hand. The app now resolves the platform from `WAYLAND_DISPLAY` and always names it, verified on a packaged build launching with no override and dragging a file to the desktop. `INSTRUMENT_OZONE_PLATFORM=x11` is the way back. The costs that decision accepts are recorded under [What the default now costs](#what-the-default-now-costs). Last updated 2026-08-29.

## The symptom

A file dragged out of the app lands nowhere. The drag image and filename render, the gesture behaves normally, and dropping the same file back into the app attaches it to the message. Any drop outside the app silently does nothing, with no drop feedback from the target at any point.

macOS and Windows are unaffected.

## What the drop target's display protocol decides

The app pinned `--ozone-platform=x11` in `apps/studio/src/electron-main/setup-environment.ts` until 1.6.6, so on a Wayland desktop it was an XWayland client while the file manager, the shell, and the desktop icons are native Wayland clients. Every drag out therefore had to cross that boundary.

Five combinations, all tested by hand:

| Drag source | Drop target | Result |
| --- | --- | --- |
| Studio (XWayland) | file manager (Wayland) | fails |
| Studio (XWayland) | desktop icons (Wayland) | fails |
| Studio (XWayland) | file manager forced to X11 | works, real file copied |
| Studio (XWayland) | Studio | works |
| GTK file manager (X11) | desktop icons (Wayland) | works, with drop feedback |

The third row clears our code: `webContents.startDrag`, the resolved host path, and the `text/uri-list` payload are all correct, because an X11 target accepts the drag and copies the real file. The fifth row clears the compositor: its XWayland-to-Wayland bridge works for a GTK source.

What is left is Chromium's browser-process-initiated drag specifically not crossing that bridge. Electron carries no Chromium patches touching drag or `OSExchangeData`, so this is stock Chromium behavior rather than something Electron introduced.

## Two instruments that lie

Worth knowing before anyone re-runs this.

`dragend`'s `dropEffect` reports `none` on this platform even for a drag that demonstrably wrote a file to disk. It cannot be used to decide whether a drop was accepted. Check the filesystem instead.

Forcing the file manager onto X11 with `GDK_BACKEND=x11 nautilus --new-window` does nothing on its own, because it is a D-Bus activated application: the command hands the request to whatever instance is already running and exits, so the window that opens belongs to the existing Wayland process. Kill the running instance first, then launch, then confirm the window is really an X11 client by looking for it in `_NET_CLIENT_LIST` before trusting any result.

## The renderer-side workaround does not work

Setting `text/uri-list` to a `file://` URI on the `dragstart` dataTransfer, and letting Chromium run the drag instead of calling `startDrag`, looked like a way to keep the pin. It fails: Chromium strips the payload on the way out of the renderer, and the receiving application gets only `text/plain`. Dropped into a file manager it produces a text file named after the URI string rather than a copy of the file.

That is a sensible restriction — a renderer should not be able to hand a local file reference to another application — and it means there is no renderer-side escape hatch for a local file on any platform.

## The pin was the cause, and dropping it was not free

The pin made the app an XWayland client on a Wayland desktop. Removing it is necessary and not sufficient: an absent `--ozone-platform` selects Chromium's compiled-in default, which is X11, and `--ozone-platform-hint=auto` does not select one from the session either. The platform has to be named.

Electron's own `BrowserWindow` documentation gives the reason anyone forces XWayland: on Wayland it is generally not possible to programmatically resize a window after creation, or to position, move, focus, or blur windows without user input. The app restores window bounds at launch and focuses windows programmatically, so the pin was carrying real weight.

Two things about the cost are worth separating. Creation-time window *size* is chosen by the client and survives; window *position* does not. Programmatic focus is the other real loss, which affects deep links and second-instance activation.

## What comparable apps do

Surveyed the other Electron AI desktop applications kept as local references, on Electron 33 through 42.

None of them pins an ozone platform. The ones on a post-38 Electron therefore run as native Wayland apps by default. The closest comparison, on Electron 39, persists and restores window bounds exactly as this app does, runs native Wayland, and answers Wayland-specific problems by patching around them — it carries a window-close timeout fallback for a compositor where the close IPC does not arrive — rather than by escaping to XWayland.

None of them ships native file drag-out at all. So there is no prior art to copy for the drag itself, and no evidence that anyone else has hit this particular boundary. The survey supports the platform choice, not the feature.

## What resolved it

Running as a native Wayland app in a Wayland session fixes the drag. Verified by hand on 2026-08-28 against the same installed build: launched with `INSTRUMENT_OZONE_PLATFORM=wayland`, a file dragged from the app landed on the GNOME desktop. The protocol was confirmed rather than assumed -- `_NET_CLIENT_LIST` was empty, so the app held no X11 window, and the main log recorded `Using ozone platform: wayland`.

So Electron's Wayland drag source does support file drags, which was the open question.

`INSTRUMENT_OZONE_PLATFORM` is what answered it, and it remains the override. It takes `x11`, `wayland`, or `auto`, defaults to `auto`, and ignores anything else with a warning:

```bash
INSTRUMENT_OZONE_PLATFORM=wayland <installed binary>
```

`auto` means read the session, and the app resolves it before Chromium sees it. It is **not a platform Chromium accepts**: passing it to `--ozone-platform` is fatal at startup with `Invalid ozone platform: auto`, and the app dies before any window exists. Leaving the switch off is not the same request either, which is the trap 1.6.6 fell into. An absent `--ozone-platform` selects Chromium's compiled-in default, which is X11, and `--ozone-platform-hint=auto` does not read the session either; both were tested against an installed build on a Wayland session. So `auto` is resolved from `WAYLAND_DISPLAY` and a real platform name is always passed.

That is also why the switch is set rather than removed. Removal fails twice over: it lands on X11 by default, and `app.commandLine.removeSwitch` does not reliably undo an `--ozone-platform` the process was started with. Read the protocol rather than the request.

Passing `--ozone-platform` on the command line instead does not work either, and fails in a way that looks like a Wayland bug rather than a conflict: the switch set in `setup-environment.ts` is applied after the process command line is parsed and overwrites it, leaving the app erroring out of an X11 presenter while asked for Wayland, with no window.

Confirm which protocol actually took before trusting a result, by either signal under [Telling which protocol took](#telling-which-protocol-took).

Dragging a file out works on macOS, on Windows, and in a Linux Wayland session. It still does nothing when the app is on XWayland, which now means only a deliberate `INSTRUMENT_OZONE_PLATFORM=x11`.

## Telling which protocol took

A native Wayland app has no X11 window, so it will not appear in `_NET_CLIENT_LIST`; under XWayland it will. That needs a working X connection to ask from.

The cheaper signal is in the app's own output. On XWayland a child process logs this on every launch:

```
ERROR:ui/base/x/x11_software_bitmap_presenter.cc:147] XGetWindowAttributes failed for window 1
```

None of those means the run is on Wayland, one or more means X11. It is a reliable A/B over a headless connection with nothing else installed, and it is what caught the 1.6.6 default.

On a host whose XWayland presenter is broken, that same line is the entire failure rather than a diagnostic. The window is created, Electron reports it visible, Chromium reports `visibilityState: "visible"` and paints a complete frame to a CDP screenshot, the shell counts the window in its dock, and no frame is ever presented to the compositor. The app runs with no window and nothing in the log a user would recognize as an error. This was seen on a QEMU/virtio guest; where XWayland presents normally the same misconfiguration shows up only as the drag failing.

## What the default now costs

Four costs were predicted. Measured against a packaged build on GNOME 46 / Ubuntu 24.04 Wayland, one is real.

**Window position restore does not survive.** `apps/studio/src/electron-main/windows/main/index.ts` spreads the saved bounds straight into the `BrowserWindow` constructor, and that object carries x/y. Wayland ignores them: saved `{ x: 300, y: 220, width: 980, height: 640 }` came back as `{ x: 16, y: 10, width: 980, height: 640 }` across a quit and relaunch. Size restores exactly; the position is the compositor's to choose, and what the app saves for it is now dead data.

**Programmatic focus works.** Electron forwards the compositor's xdg-activation token between instances by itself: the second instance injects it into its command line around `NotifyOtherProcessOrCreate`, and the first extracts it and sets it globally before the `second-instance` event fires. Both are armed by `app.requestSingleInstanceLock()`. Activating an already-running app from the desktop raises its window, and the app reports itself focused.

Testing that claim needs a launch the compositor issued a token for, which in practice means the desktop's own launcher. A second instance started from an SSH shell carries no token, so the focus request has no authority no matter what the app does, and a test built that way reports a failure belonging to the test.

**Client-side decorations cost nothing.** `getBounds()` and `getContentBounds()` are pixel-identical on a Wayland window, so the custom title bar, the window controls and the agent-browser paint host are positioned against the geometry they always saw.

**The window hairline is the compositor's.** A frameless window is decorated by the compositor under Wayland and by nothing at all under X11, so the CSS border is conditional on the session -- see `apps/studio/src/client/components/window-border.tsx`. The fractional-scale clipping that border suffered under XWayland cannot arise on Wayland, because there is no hairline of ours there to clip.
