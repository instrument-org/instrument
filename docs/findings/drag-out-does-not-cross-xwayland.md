# Dragging a file out does not cross from XWayland to Wayland

**Status:** open, with the fix identified and half verified. Reproduced by hand on Ubuntu 24.04.4 with GNOME Shell 46 in a Wayland session, against a shipped beta, 2026-08-28. The cause is the `--ozone-platform=x11` pin, not our drag code. Running the same build as a native Wayland app makes the drag work, confirmed by hand the same day; what has not been measured is what that costs in window control, so the default is unchanged and a normal launch is still affected. Last updated 2026-08-28.

## The symptom

A file dragged out of the app lands nowhere. The drag image and filename render, the gesture behaves normally, and dropping the same file back into the app attaches it to the message. Any drop outside the app silently does nothing, with no drop feedback from the target at any point.

macOS and Windows are unaffected.

## What the drop target's display protocol decides

The app pins `--ozone-platform=x11` in `apps/studio/src/electron-main/setup-environment.ts`, so on a Wayland desktop it is an XWayland client while the file manager, the shell, and the desktop icons are native Wayland clients. Every drag out therefore has to cross that boundary.

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

## The pin is the cause, and it is load-bearing

Electron 38 changed its default to running as a native Wayland app in a Wayland session. The pin opts back out of that.

Electron's own `BrowserWindow` documentation gives the reason anyone forces XWayland: on Wayland it is generally not possible to programmatically resize a window after creation, or to position, move, focus, or blur windows without user input. The app restores window bounds at launch and focuses windows programmatically, so removing the pin is not free.

Two things about the cost are worth separating. Creation-time window *size* is chosen by the client and survives; window *position* does not. Programmatic focus is the other real loss, which affects deep links and second-instance activation.

## What comparable apps do

Surveyed the other Electron AI desktop applications kept as local references, on Electron 33 through 42.

None of them pins an ozone platform. The ones on a post-38 Electron therefore run as native Wayland apps by default. The closest comparison, on Electron 39, persists and restores window bounds exactly as this app does, runs native Wayland, and answers Wayland-specific problems by patching around them — it carries a window-close timeout fallback for a compositor where the close IPC does not arrive — rather than by escaping to XWayland.

None of them ships native file drag-out at all. So there is no prior art to copy for the drag itself, and no evidence that anyone else has hit this particular boundary. The survey supports the platform choice, not the feature.

## What would resolve it

Running as a native Wayland app in a Wayland session fixes the drag. Verified by hand on 2026-08-28 against the same installed build: launched with `INSTRUMENT_OZONE_PLATFORM=wayland`, a file dragged from the app landed on the GNOME desktop. The protocol was confirmed rather than assumed -- `_NET_CLIENT_LIST` was empty, so the app held no X11 window, and the main log recorded `Using ozone platform: wayland`.

So Electron's Wayland drag source does support file drags, which was the open question. What remains unmeasured is the other half: what native Wayland costs in window position restore and programmatic focus, against what the app actually needs.

`INSTRUMENT_OZONE_PLATFORM` exists to answer the first half. It takes `x11`, `wayland`, or `auto`, defaults to `x11`, and ignores anything else with a warning:

```bash
INSTRUMENT_OZONE_PLATFORM=wayland <installed binary>
```

`auto` is worth understanding before using it. It is Electron's own default since 38 and means native Wayland in a Wayland session, but it is **not a platform Chromium accepts**: passing it to `--ozone-platform` is fatal at startup with `Invalid ozone platform: auto`, and the app dies before any window exists. It is the name of what Chromium does when the flag is absent, so asking for it means removing the switch rather than setting it -- including the `--ozone-platform=x11` the packaged launcher puts on argv, which is why the app does not simply respect an unset variable. `wayland` names a real platform and is the more direct thing to test with.

Passing `--ozone-platform` on the command line instead does not work either, and fails in a way that looks like a Wayland bug rather than a conflict: the switch set in `setup-environment.ts` is applied after the process command line is parsed and overwrites it, leaving the app erroring out of an X11 presenter while asked for Wayland, with no window.

Confirm which protocol actually took before trusting a result. A native Wayland app has no X11 window, so it will not appear in `_NET_CLIENT_LIST`; under XWayland it will.

Until that test is run, dragging a file out works on macOS, on Windows, and in a Linux X11 session, and does nothing in a Linux Wayland session, which is the default on current Ubuntu.
