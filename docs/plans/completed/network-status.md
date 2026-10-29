# Plan: one network status, shown in the window's corner

Status: **landed in full**: the status, the window-bar pill and its card in `f5721409f` (which replaced `PlatformApiIndicator`), setup's pill opening the card in `2d35eedf9`. The card's Status link waits on a status page.

When the computer is offline, or online but Instrument's servers don't answer, the window's corner says so with one pill, in setup and in the app alike. No screen handles the network itself: forms, sheets and sign-in pages stay as they are, and a request that fails while the pill is up fails the way it always does.

## The status

One value, kept in main (`electron-main/lib/network-status.ts`) and sent live to every window over `network.live.status` (`NetworkStatus`, `shared/network-status.ts`). A development build's `INSTRUMENT_NETWORK_STATUS=offline|instrument-unreachable` pins it, for scenarios and screenshots:

- `online`: the computer has a connection and the platform API answers.
- `offline`: Electron's `net.isOnline()` says there is no connection. Checked when the OS reports a change (`powerMonitor` and the renderer's `online`/`offline` events, forwarded) and on a slow timer, since `net.isOnline` can miss a dropped Wi-Fi network that still holds an address.
- `instrument-unreachable`: online, and the platform API does not answer. It comes from the probe (`platform-api/reachability.ts`), which asks only while something failed: every 5 seconds in a development build, doubling from 5 seconds to a minute in a packaged one. Any HTTP response counts as an answer, so an API error is not "unreachable".

A failed request to the platform API reports its outcome to the probe as it does now, so the status turns as soon as a request finds out, not only on the timer. Coming back online, or the API answering again, runs the queries that failed again.

## On screen

- **The pill**, beside the bell in the window bar, and in setup's top-right corner. Offline: "You're offline. Connect to continue." in setup, "Offline" in the app. Unreachable: "Can't reach Instrument". It goes away by itself.
- **The card**, opened from the app's pill. Offline: "You're offline" / "Instrument can't reach AI providers until your computer is back online. Your local files and folders still work." Unreachable: "Can't reach Instrument models" / "Chats on Instrument models, web search, and dictation aren't available right now." A Status link joins it once there is a status page. It never mentions other providers.

The development-build indicator for an API server that isn't running (`PlatformApiIndicator`) becomes this pill, naming the server only in developer mode.

## Out of scope

- Holding Send, or continuing a dropped turn by itself.
- Per-provider reachability (ChatGPT, Claude, Grok, key providers): their failures stay their own errors.
