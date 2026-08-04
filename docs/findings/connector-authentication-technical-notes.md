# Connector authentication: technical notes

Where connector authentication stands, and what each identified change actually involves.

## Where things stand

Connectors come in two shapes, defined by the manifest schema:

- **`api`** connectors make authenticated HTTP requests. Auth kinds are `bearer`, `header`, `query`, `none`. All of them are a static secret supplied by the user. There is no OAuth on this path.
- **`mcp`** connectors call tools on a hosted MCP server over Streamable HTTP. Auth kinds are `bearer`, `header`, `none`, `oauth`.

Interactive sign-in therefore exists in exactly one place: `mcp` connectors with `auth.kind: "oauth"`. That path relies on the MCP SDK for discovery, dynamic client registration (RFC 7591), PKCE, and token exchange. Our OAuth provider advertises `token_endpoint_auth_method: "none"`, so it only works against servers that support DCR and public clients.

Agents author connectors themselves: they write `connector.json` plus `guide.md` under the connectors mount, then run `connector_test`, which validates the manifest, scans for embedded secrets, and fires a canary request before flipping `enabled`. Credentials and OAuth artifacts live in the app's encrypted store, never in connector files and never in model context.

### Token refresh is not ours

Worth knowing before planning any of the work below. Refresh is handled entirely inside the MCP SDK: the transport receives a 401, calls `auth()`, which calls `refreshAuthorization()`, persists through `provider.saveTokens()`, and retries the request. We supply a storage implementation and nothing else.

Two consequences:

- Refresh is **reactive, not proactive**. There is no expiry tracking and no timer. The first call after expiry pays a 401, a refresh, and a retry.
- Anything that rides the same provider interface **inherits refresh for free**. This is the single most useful lever in this document and it shapes the recommendation for tier-2 providers below.

When refresh fails unrecoverably, the SDK falls through to a fresh authorization, which calls `redirectToAuthorization`. In tool context that deliberately throws, since a tool call cannot open a browser and wait. The agent surfaces it as "reconnect from Settings."

## The changes

### 1. Make the catalog visible to the agent

The built-in catalog currently has exactly one non-test consumer: the Studio settings RPC route. The agent never sees it. Per-turn context lists only already-installed connectors, and exists mainly to stop the agent recreating or clobbering them.

So a request like "check my Linear issues" sends the agent off to research a service it already has an entry for, and it cannot distinguish a service that connects in one click from one that needs groundwork.

Shape of the fix: a lookup tool returning slug, type, endpoint, auth kind, and a "one click" flag. A tool rather than context injection, so it scales past a handful of entries without spending tokens every turn.

Open: whether the seed stays curated or refreshes from the public index. Catalog parsing is already validated and cached, so a live layer can sit on top without changing the entry shape.

### 2. An in-task path to connecting something new

The user-facing half of change 1. Three surfaces can start a connection, and none of them covers a user who wants to connect something new without leaving the task they are in.

- The Settings tab renders the catalog with a Set up button. That button stashes a one-shot prompt, closes the modal, and opens a **new tab**, so the originating task is abandoned.
- The composer menu queries the connector list and offers only `enabled` ones as `@slug` mentions. Its empty state is a disabled "No connectors yet," and its only other item routes to Settings.
- The agent-initiated interactive prompts render a Connect button or a secure field inline in the conversation. This is the best of the three, but it only fires once the agent has decided it needs a connector, which is gated on change 1.

Almost all the pieces exist. The catalog is already exposed over RPC, the composer menu already queries connector state, and the interactive prompt components already render a working connect flow inline. What is missing is a path that surfaces the catalog from the composer and completes setup against the current task rather than spawning a new one.

Worth deciding alongside it: whether user-initiated setup should reuse the agent-driven route (hand the current task a request and let the agent author the manifest, which is what Set up does today, just into the wrong task) or connect directly from the interface for catalog entries where nothing needs authoring.

### 3. Pre-registered OAuth clients, for providers without DCR

Slack and GitHub both run real MCP servers, both support the standard discovery documents, and both refuse dynamic registration. Slack states this outright and additionally requires that clients be backed by a registered app with a fixed, hardcoded app ID, published to their marketplace.

The tempting move is a bespoke OAuth flow per provider. Resist it. The originating implementation went that way and ended up with separate hand-written flows for Google, Slack, and Microsoft, each with its own token lifecycle to maintain.

The cheaper path: our provider already reads client identity from the store rather than assuming DCR produced it. Seeding a static client ID for a known provider, and skipping the registration step, leaves discovery, PKCE, token exchange, refresh, retry, and encrypted storage untouched. Tier-2 providers become a small amount of configuration rather than a parallel implementation.

Slack specifics that matter for this:

- PKCE is supported, so we ship a client ID and no secret. Enabling PKCE marks the app a public client permanently and cannot be undone without contacting them.
- Loopback redirects count as desktop redirects once PKCE is on, so no custom URL scheme is needed.
- Refresh tokens rotate and expire in 30 days, so an idle user re-authenticates and an active one never does.
- Desktop redirects cannot request bot scopes. User scopes only.

### 4. Pin the OAuth callback port

Currently the redirect URL handed to the OAuth flow is built from the default port constant, while the callback server binds a detected free port. When the default is occupied, which is routine with a second instance running, the browser returns to a port nothing is listening on and the sign-in dies with no useful signal.

Fix is to derive the redirect from the port actually bound. This becomes more than a bug once tier-2 providers exist: their redirect URIs are registered ahead of time and cannot vary per launch, so we will need either a guaranteed port or a small registered range.

### 5. Surface stale connections before they fail

The connector list exposes `enabled` and whether a credential is present. It has no representation for "connected, but the grant is dead." A user discovers expiry mid-task when a tool call fails.

Needed: a `needs_reauth` state on the list output, plus revalidation on a cheap trigger such as app focus. The agent-side behavior is already correct and does not need changing.

### 6. Local MCP servers

The largest gap, and the one furthest from the current design.

Our MCP client uses Streamable HTTP exclusively. There is no stdio transport and no process spawning, so servers that run on the user's machine cannot be reached at all. One partial exception: the manifest deliberately permits `http://` for loopback hosts, so a local server already listening on localhost works today. What is missing is launching and managing the process.

The originating implementation does support this, and its approach is worth knowing because it maps the problem well:

- Config carries `command`, `args`, and `env`; the SDK's stdio transport spawns it.
- The child inherits `process.env` minus a hardcoded blocklist of credential-shaped variables.
- Their connection test spawns the process for real and counts tools, with dedicated error messages for command-not-found and for processes that emit startup noise but never complete the handshake.
- Stdio sources are treated as never requiring auth, which is correct: there is no token, nothing to refresh, nothing to expire.
- Read-only permission patterns apply the same way they do for remote servers.

Four things need deciding on our side.

**Spawning arbitrary commands is the real decision.** Agents author manifests. If a manifest can carry `command` and `args`, then an agent-authored manifest is arbitrary code execution on the host with the user's environment. The originating implementation spawns whatever is configured, with no allowlist. Our existing write guard only prevents clobbering an enabled connector; it says nothing about execution. Options, roughly in order of how much they cost the experience: explicit user confirmation before the first spawn of a given command, an allowlist of known server packages tied to catalog entries, or restricting the command to a bundled runtime with only the package as a variable.

**Environment inheritance should be an allowlist, not a blocklist.** A blocklist of credential-shaped variable names fails open, which is the wrong default when the child is third-party code. The child needs very little.

**PATH is a real problem, with a known solution.** GUI-launched apps on macOS inherit a minimal PATH, so anything installed via Homebrew or a version manager is invisible. The established fix is harvesting the user's login shell environment at startup, which the originating implementation does on macOS only, skipped in dev. They also bundle binaries and prepend them to PATH, which is the precedent for removing the "install a runtime first" step entirely if we decide the onboarding cliff is unacceptable.

**Connection lifecycle needs revisiting.** We currently open and close a connection per operation, which is fine over HTTP and expensive when each open means spawning a process. Local servers make pooling worth doing rather than optional.

On sandbox posture: a spawned server runs outside our containment with host access. That is not unprecedented, since the architecture already has real-binary escape hatches that behave the same way. It is a deliberate line, and this feature crosses it on purpose.

### 7. OAuth for `api` connectors

Only relevant if we pursue Gmail directly. It means a new auth kind on the `api` manifest, an OAuth client we register and own, and a token lifecycle written by hand, because the refresh machinery we get for free is specific to the MCP path.

That asymmetry is the argument for keeping every provider that has an MCP server on the MCP path, even when it needs a pre-registered client. Gmail is the case where no such server exists, which is a large part of why it is expensive.

## Summary

| Change                                | Size                | Notes                                                              |
| ------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| Catalog lookup tool for the agent     | Small               | Highest payoff per unit of work                                    |
| In-task path to connect something new | Small               | Mostly client work; the catalog is already exposed over RPC        |
| Pin the OAuth callback port           | Small               | Bug today, blocker for tier 2                                      |
| `needs_reauth` state and revalidate   | Small               | Removes the worst failure moment                                   |
| Pre-registered clients for tier 2     | Small once decided  | Configuration, not a parallel implementation, if kept on this path |
| Local MCP servers                     | Medium              | Mostly policy decisions, not transport work                        |
| OAuth for `api` connectors            | Medium, plus Google | Only for Gmail via direct integration                              |
