# `curl` and `web_fetch` reach the local network, except Instrument's own workspace server

Date: 2026-10-06

Supersedes [2026-07-24-web-fetch-private-address-guard.md](2026-07-24-web-fetch-private-address-guard.md).

## Context

Instrument is a desktop app that runs only on the user's own computer, and its agent works on the user's behalf. The shell's `curl` ran under just-bash's `denyPrivateRanges`, and `web_fetch` carried a guard of its own (`lib/private-address.ts`) to match it, so both refused loopback, RFC1918, link-local, CGNAT, IPv6 unique-local and link-local addresses, and any name resolving to one, `.local` hosts included. App requests (`lib/apps/safe-url.ts`) refused the same ranges for any app whose base URL was not itself loopback.

The block was never a boundary. `node` and `python-native` are real processes on this computer and reach every one of those addresses ([finding](../findings/loopback-block-is-curl-only.md)). What the block did was steer the agent away from the tools it knows best, and make it wrong about what it could do: a task looking for a pool controller on the user's LAN at `10.110.1.x`, with Home Assistant at `homeassistant.local` also involved, concluded it had no way onto the local network. The shell's tool description told the agent to write a `node` script to reach a server it had just started, and the system prompt described the shell as "sandboxed", which an agent read as having no network.

## Decision

`curl` (and the `fetch` in `js-exec` and `jb_http` in `python`, which share it), `web_fetch`, and app requests reach every address the shell's native processes can: the internet, loopback, and the whole local network.

The one exception is Instrument's own workspace server: a loopback host (`127.0.0.0/8`, `0.0.0.0/8`, `::1`, `::`, or the v4-mapped forms, or a name resolving to any of them) on the port that server bound. Its routes, the CDP bridge among them, were never audited for a caller the agent controls, and an app request there would carry a credential into the model proxy. `lib/workspace-server-address.ts` answers it for all three paths, against `getWorkspaceServerPort()`, which the bash worker receives from the main thread with every command.

just-bash's network config can allow URLs but cannot deny one, so the shell's fetch is ours: `lib/sandbox-fetch.ts`, handed to just-bash as `BashOptions.fetch`. It follows redirects by hand and checks every hop, and otherwise keeps what `network` gave: any method, 20 redirects, a 30-second timeout, the 256 MB body cap, and just-bash's error classes, so a refusal is `curl` exit 7 with `Network access denied: ...`. `web_fetch` and app requests already followed redirects by hand and check each hop the same way.

Connected apps get the same reach as `curl`, rather than a narrower one. A self-hosted service on the LAN is the same kind of thing for an app as for `curl`, and a stricter app path would only send the agent to `curl` or `node` with the credential in hand. App requests keep their https requirement for every non-loopback hop, since they carry the user's credential: a plain-http service on the LAN is reachable from `curl` but not yet as an app.

## Consequences

- The agent can call a server it started, and the user's own devices and services, with the tools it reaches for first. The shell's tool description and the task agent's system info say so.
- Fetched content that says "now request `http://192.168.1.1/admin`" is no longer refused by the tool. That was the injection route the old guard was worth something against; it is accepted, since the native processes the agent writes code for reach the same addresses, and the user's network is part of what the agent works on for them.
- The workspace-server refusal is not a boundary either. It is resolve-then-connect, so a name that answers differently on the second lookup gets through, and `node` and `python-native` reach the port regardless. It keeps the obvious path off a server whose routes are unaudited.
- Another Instrument instance's workspace server (a second dev checkout, on a fallback port) is not refused. Only this process's own port is known.
- `sandbox-fetch.ts` runs inside just-bash's trusted scope (`DefenseInDepthBox.runTrustedAsync`), as just-bash's own fetch does, because Node's `fetch` reaches for `WeakRef`, which defense-in-depth blocks inside the untrusted `curl` builtin. just-bash 3.4.1 publishes no type declarations for that class, so the call is untyped.

## Implementation

- [Workspace server check](../../packages/workspace/src/lib/workspace-server-address.ts)
- [Shell fetch](../../packages/workspace/src/lib/sandbox-fetch.ts), wired in [create-bash-env.ts](../../packages/workspace/src/lib/create-bash-env.ts)
- [web_fetch](../../packages/workspace/src/tools/web-fetch.ts)
- [App URL check](../../packages/workspace/src/lib/apps/safe-url.ts)
