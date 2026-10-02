# A driven chord opens the About panel

**Status:** fixed on both paths. The drive skill's `press` no longer sends `nativeVirtualKeyCode` on macOS, and the guest relay strips it from what the browser client sends. The durable part is the belief it corrects: a CDP-injected key event can reach the native macOS menu, so a chord that appears to do nothing is not proof that nothing happened. Measured 2026-09-08.

Driving Studio with the chrome-devtools skill's `press` verb could open the macOS standard About panel over whatever window the person at the machine was in. It read as unrelated to the agent's work: the chord did not do the thing it was sent for, the run reported a successful press and moved on, and the panel arrived on someone else's screen a moment later.

## Why

`press` derived one key code from the character (`"L".codePointAt(0)` is 76) and sent it as both `windowsVirtualKeyCode` and `nativeVirtualKeyCode`. The first is right, since 76 is `VK_L`. The second is read as the platform's own numbering, and macOS numbers 76 as the keypad's Enter, so every modified chord named a key the event's own character disagreed with.

`About <app>` is the first item of the first menu and the one item in it carrying no key equivalent of its own, and an item without one still carries the default Command modifier mask. A Command-flagged event resolving to no usable character matches that item before anything else. The exact AppKit path was not traced, but the field is: dispatching `Cmd+L` over raw CDP against a focused window opened the panel on the first press with `nativeVirtualKeyCode: 76` present, and opened nothing in five presses with the field removed and everything else identical.

## The same mistake ships

The drive skill is where this was found, but it is not the only place. The browser client the agent drives guests with fills `native_virtual_key_code` and `windows_virtual_key_code` from one value taken from Playwright's US layout table, whose codes are Windows codes by construction, and the relay in `apps/studio/src/electron-main/browser-view/dispatch-command.ts` forwards what the client sends. So the agent typing a Command chord into an in-app browser could open the About panel on a user's machine, against the user's own menu.

That relay is the seam to correct it in, because the client is a prebuilt binary. `withoutMacNativeKeyCode` drops the field there on macOS, next to the editing-commands rewrite that was already correcting key events on that platform.

## Why it stayed hidden

The panel is a native panel, not a `BrowserWindow`. It has no CDP page target, so a target list cannot see it and a CDP screenshot cannot show it. Nothing an agent can observe through its own connection changes when it opens, which is why runs that opened one recorded a clean session.

It also needs the driven window to be key. That makes it intermittent, and it means the window it lands on is the one a person is using rather than a background instance. A freshly booted instance is key, so it fires early in a run.

Against that, the belief that a CDP-injected key event never reaches a menu (stated in `apps/studio/src/electron-main/browser-view/mac-editing-commands.ts`, which exists because chords do not reach the menu the way its editing commands need) reads as a reason to stop looking. It holds for the editing chords that module maps. It does not hold for a chord carrying a keycode the platform resolves to another key.

## Seeing it from outside

`CGWindowListCopyWindowInfo` lists every window of a process with its size and needs no Screen Recording permission, which only gates window titles. The panel is a persistent window of about 284x170 at layer 0 owned by the app process. A few lines of Swift compiled to a binary is the cheapest detector; leave `.optionOnScreenOnly` out of the options or a window on another Space is missed.
