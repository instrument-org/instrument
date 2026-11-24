# Whether agent-browser can run without its stream server

**Status:** open · **Check after:** 2026-12-21, or at the next agent-browser upgrade · **Last checked:** 2026-11-23

## What we're waiting to learn

The agent-browser daemon always starts a stream server, an HTTP and WebSocket listener on a loopback port that serves upstream's live-view dashboard, and writes its port to `<session>.stream` in the socket folder. The app never uses it: the browser view has its own screencast. Yet the listener is up whenever the agent has the browser open. Upstream tracks what that listener answers in vercel-labs/agent-browser#1896, and has proposed an `AGENT_BROWSER_NO_STREAM` switch that starts the daemon with no TCP listener (vercel-labs/agent-browser#1591). Its checks on what the listener answers have shipped (see the result below), so the question left is whether a release ships the switch, so the app can stop running a listener it has no use for.

## The signal

- A release whose source reads `AGENT_BROWSER_NO_STREAM` in `cli/src/native/daemon.rs` before it calls `StreamServer::start_without_client`.
- A release whose `cli/src/native/stream/http.rs` authenticates `/api/command` with more than a matching Origin, and refuses a read that carries no Origin.
- Neither: `daemon.rs` still starts the stream server unconditionally, and nothing has changed since the last check.

## Where to look

agent-browser's releases, and those two files at the newest tag (`agent-reference get agent-browser@<version>`).

## What each answer means

- **The switch ships:** bump `agent-browser` in `packages/workspace` and `apps/studio`, and set `AGENT_BROWSER_NO_STREAM=1` everywhere the app sets `AGENT_BROWSER_SOCKET_DIR` for the CLI (`git grep AGENT_BROWSER_SOCKET_DIR`), since a daemon's settings have to match across every invocation of its session. Then check that no `.stream` file appears in the socket folder while the agent uses the browser.
- **Only stronger route checks ship:** bump, and repeat the requests in the result below from another process.
- **Neither:** decide whether what a local process can still do is worth keeping the daemon from opening a TCP listener ourselves. On macOS, start it under a sandbox rule that denies binding a TCP port; the daemon logs that the stream server failed to start and carries on over its Unix socket. Check that the agent browser still works, or carry a patched build. Move the date.

## Result

Checked at agent-browser 0.44.0, the release the app moved to.

- **No switch.** Nothing in the release reads `AGENT_BROWSER_NO_STREAM`, and the daemon still starts the listener for every session.
- **Route checks shipped.** Every `/api/` route refuses a request whose `Host` is not loopback, or whose `Origin` or `Referer` does not match its `Host`, with 403 and no CORS headers. `/api/command` also refuses a request that carries neither. That closes the listener to a web page, by DNS rebinding or a cross-site request.
- **A local process is still answered.** Against a daemon running its own headless Chrome: a read with no `Origin` from a loopback `Host` (`/api/tabs`) answered 200 with each tab's address and title; the same read with a foreign `Host` or `Origin` answered 403; a command with no `Origin`, or a foreign one, answered 403; a command with an `Origin` matching the listener's own address answered 200. A local process chooses its own headers, so the Origin check does not stand between it and the command relay.

So the listener is no longer reachable from the web, and what remains is what any process running as the person can already do through the daemon's own socket. The follow-up stays open for the switch.
