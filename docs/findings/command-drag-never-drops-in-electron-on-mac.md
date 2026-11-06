# Command-drag never drops in Electron on the Mac

Holding Command through a drag the app started with `startDrag` ends with no `drop` event, on the same disk or across disks, so the gesture does nothing in Files: the drag image returns to where it started. macOS's file manager moves the item in both cases.

**What was seen.** Real pointer drags on a macOS 27 VM against a packaged build. `dragover` arrives throughout and `effectAllowed` reads `all`, but no `drop` follows whichever `dropEffect` the page sets (`copy`, `link`, `move`). Option, and Option with Command, drop normally.

**The likely cause, not confirmed in source.** Under Command, AppKit narrows a drag's operations to the generic one. Chromium reads that as every operation being allowed and answers with a specific one, which AppKit then refuses.

**What was rejected.** Watching for the pointer to come back after a drag with Command held, and moving the file then. A drag canceled with Esc looks the same, so it could move a file nobody meant to move.

**What might resolve it.** Having the drag source ignore modifier keys (`ignoreModifierKeysForDraggingSession:`) through the Mac bridge, so the operations stay whole and the page reads `metaKey` itself. That is a swizzle on Electron's drag source, so it has to be checked on every Electron upgrade. A fix upstream would replace it.

**Confirmed by hand.** A person ⌘-dragging a file into a folder sees the drag image animate back to where it started, and nothing moves. The pointer and modifiers in the runs above came from a desktop driver, which lets Option go just before the button when Option is the only modifier held, so an Option-only result from it says nothing about the drop.
