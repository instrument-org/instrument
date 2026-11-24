# agent-browser's network-idle wait reported success when it timed out

**Status:** fixed upstream. From agent-browser 0.44.0 a load-state wait that runs out fails and names the state and the time it was given. The wrapper (`agent-browser-wait.ts`) keeps the five-second timeout it gives an uncapped `wait --load networkidle`, and still answers that timeout as a loaded page whose network stayed busy.

## Symptom

Through agent-browser 0.39, `agent-browser wait --load networkidle` on a page that keeps a request open ran for 25 seconds, then printed `✓ Done` and exited 0. The agent could not tell that from a page that went quiet, so nothing taught it to stop asking. In the app's own history that shape, an `open` and a network-idle wait coming back after 25 to 28 seconds with `✓ Done`, accounted for most of the time spent in network-idle waits: Amazon search and product pages, shops (Giro, Domino's, OpenTable, Etsy, Liquid I.V.), museums and Home Assistant.

## Cause

Two timers, and the inner one's error was dropped. `handle_waitforloadstate` (upstream `cli/src/native/actions.rs`, the same in 0.31.1, 0.33.1, 0.38.1 and 0.39.1) wrapped the wait in a timeout of the command's own `--timeout`, and discarded the wait's result:

```rust
let _ = tokio::time::timeout(
    tokio::time::Duration::from_millis(timeout_ms),
    mgr.wait_for_lifecycle_external(wait_until, &session_id),
)
.await
.map_err(|_| format!("Timeout waiting for load state: {}", load_state))?;
```

Inside, `poll_network_idle` (`browser.rs`) ran its own timeout of the daemon's default (25 seconds, `AGENT_BROWSER_DEFAULT_TIMEOUT`) and returned `Err("Timeout waiting for networkidle")`. With no `--timeout`, both timers were 25 seconds and the inner one fired first, so its error landed in `let _` and the handler returned `Ok`. A `--timeout` shorter than the default made the outer timer fire first, and that error did reach the agent: `✗ Operation timed out. The page may still be loading or the element may not exist.`, exit 1.

The idle rule itself is 500 ms with no request in flight, checked on a 600 ms receive timeout, so a quiet page costs between 0.6 and 1.9 seconds. Requests already in flight when the wait starts are not tracked; a request that starts afterwards and never finishes (a beacon, a long poll) holds it open forever.

## Measured

agent-browser 0.38.1 launching its own Chrome on a Mac, each page opened (which waits for the load event) and then waited on:

| Page | Network-idle wait | Content after `open` alone |
| --- | --- | --- |
| Amazon search (5 queries) | 25.0 to 25.3 s, `✓ Done` every time | all 16 results present |
| Amazon product (5 pages) | 25.0 to 25.1 s, `✓ Done` every time | title, price and review count present |
| The Verge (3 loads) | 25.0 s every time | same headline count before and after |
| Giro, Liquid I.V., MDN CSS grid | 25.0 s | unchanged |
| NYTimes, GitHub, MDN fetch, TodoMVC, Domino's, Tate | 0.6 to 1.9 s | unchanged |

On no page did the wait change what a snapshot or a probe of the content found. The in-app browser reaches the same handler through the CDP bridge, and the app's history showed the same 25 to 28 second `✓ Done` on the same sites there.

## What upstream does now

One timer: the handler passes the command's timeout into the wait and returns its error (`mgr.wait_for_lifecycle_external(wait_until, &session_id, timeout_ms).await?`). A wait that runs out prints `✗ Timed out after 5000ms waiting for load state 'networkidle'` and exits 1, and `to_ai_friendly_error` leaves that line as it is instead of replacing it with the generic timeout line. Checked against the 0.44.0 binary on a page that fetches every 200 ms.

## What the wrapper still does

- An uncapped `wait --load networkidle` gets `--timeout 5000`: five seconds is longer than any page that does go quiet took, and it keeps a busy page from costing 25.
- A timeout that names that cap is answered as success with a line saying the network stayed busy, since the page has loaded and a failure would end the `&&` chain the agent wrote to read it. Any other failure, a timeout that names another budget included, reaches the agent as upstream printed it.
