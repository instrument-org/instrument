# agent-browser's network-idle wait reports success when it times out

**Status:** worked around in the wrapper (`agent-browser-wait.ts`), which gives an uncapped `wait --load networkidle` a five-second timeout and says so when the network stayed busy. The upstream fix is open as [vercel-labs/agent-browser#2123](https://github.com/vercel-labs/agent-browser/pull/2123).

## Symptom

`agent-browser wait --load networkidle` on a page that keeps a request open runs for 25 seconds, then prints `✓ Done` and exits 0. The agent cannot tell that from a page that went quiet, so nothing teaches it to stop asking. In the app's own history that shape, an `open` and a network-idle wait coming back after 25 to 28 seconds with `✓ Done`, accounts for most of the time spent in network-idle waits: Amazon search and product pages, shops (Giro, Domino's, OpenTable, Etsy, Liquid I.V.), museums and Home Assistant.

## Cause

Two timers, and the inner one's error is dropped. `handle_waitforloadstate` (upstream `cli/src/native/actions.rs`, the same in 0.31.1, 0.33.1, 0.38.1 and 0.39.1) wraps the wait in a timeout of the command's own `--timeout`, and discards the wait's result:

```rust
let _ = tokio::time::timeout(
    tokio::time::Duration::from_millis(timeout_ms),
    mgr.wait_for_lifecycle_external(wait_until, &session_id),
)
.await
.map_err(|_| format!("Timeout waiting for load state: {}", load_state))?;
```

Inside, `poll_network_idle` (`browser.rs`) runs its own timeout of the daemon's default (25 seconds, `AGENT_BROWSER_DEFAULT_TIMEOUT`) and returns `Err("Timeout waiting for networkidle")`. With no `--timeout`, both timers are 25 seconds and the inner one fires first, so its error lands in `let _` and the handler returns `Ok`. A `--timeout` shorter than the default makes the outer timer fire first, and that error does reach the agent: `✗ Operation timed out. The page may still be loading or the element may not exist.`, exit 1. `wait --load load` has the same shape, but it resolves at once on a page whose `readyState` is already `complete`, so it rarely matters.

The idle rule itself is 500 ms with no request in flight, checked on a 600 ms receive timeout, so a quiet page costs between 0.6 and 1.9 seconds. Requests already in flight when the wait starts are not tracked; a request that starts afterwards and never finishes (a beacon, a long poll) holds it open forever.

## Measured

agent-browser 0.38.1 launching its own Chrome on this Mac, each page opened (which waits for the load event) and then waited on:

| Page | Network-idle wait | Content after `open` alone |
| --- | --- | --- |
| Amazon search (5 queries) | 25.0 to 25.3 s, `✓ Done` every time | all 16 results present |
| Amazon product (5 pages) | 25.0 to 25.1 s, `✓ Done` every time | title, price and review count present |
| The Verge (3 loads) | 25.0 s every time | same headline count before and after |
| Giro, Liquid I.V., MDN CSS grid | 25.0 s | unchanged |
| NYTimes, GitHub, MDN fetch, TodoMVC, Domino's, Tate | 0.6 to 1.9 s | unchanged |

On no page did the wait change what a snapshot or a probe of the content found. The in-app browser reaches the same handler through the CDP bridge, and the app's history shows the same 25 to 28 second `✓ Done` on the same sites there.

## Fix upstream

Propagate the inner result (`.await.map_err(...)??`), so a network that never goes quiet reports `Timeout waiting for networkidle` instead of `Done`. The wrapper's cap can stay either way: five seconds is longer than any page that does go quiet took, and it keeps a busy page from costing 25.
