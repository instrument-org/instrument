# Whether agent-browser can run without its stream server

**Status:** open · **Check after:** 2026-11-26 · **Last checked:** never

## What we're waiting to learn

The agent-browser daemon always starts a stream server, an HTTP and WebSocket listener on a loopback port that serves upstream's live-view dashboard, and writes its port to `<session>.stream` in the socket folder. The app never uses it: the browser view has its own screencast. Yet the listener is up whenever the agent has the browser open. Upstream tracks what that listener answers in vercel-labs/agent-browser#1896, and has proposed both an `AGENT_BROWSER_NO_STREAM` switch that starts the daemon with no TCP listener (vercel-labs/agent-browser#1591) and a loopback Host check on every route (vercel-labs/agent-browser#2488). The question is whether a release ships one of these, so the app can stop running a listener it has no use for.

## The signal

- A release whose source reads `AGENT_BROWSER_NO_STREAM` in `cli/src/native/daemon.rs` before it calls `StreamServer::start_without_client`.
- A release whose `cli/src/native/stream/http.rs` refuses every `/api/` request whose Host is not loopback, and authenticates `/api/command` with more than a matching Origin.
- Neither: `daemon.rs` still starts the stream server unconditionally, and nothing has changed.

## Where to look

agent-browser's releases, and those two files at the newest tag (`agent-reference get agent-browser@<version>`).

## What each answer means

- **The switch ships:** bump `agent-browser` in `packages/workspace` and `apps/studio`, and set `AGENT_BROWSER_NO_STREAM=1` everywhere the app sets `AGENT_BROWSER_SOCKET_DIR` for the CLI (`git grep AGENT_BROWSER_SOCKET_DIR`), since a daemon's settings have to match across every invocation of its session. Then check that no `.stream` file appears in the socket folder while the agent uses the browser.
- **Only the route checks ship:** bump, and check that a request to the stream port from another process is refused.
- **Neither:** keep the daemon from opening a TCP listener ourselves. On macOS, start it under a sandbox rule that denies binding a TCP port; the daemon logs that the stream server failed to start and carries on over its Unix socket. Check that the agent browser still works, or carry a patched build. Move the date.

## Result

Not yet checked.
