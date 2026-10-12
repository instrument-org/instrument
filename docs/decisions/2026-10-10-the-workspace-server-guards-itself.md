# The workspace server guards itself, so the agent's HTTP tools refuse no address

Date: 2026-10-10

Supersedes the workspace-server exception in [2026-10-06-curl-and-web-fetch-reach-the-local-network.md](2026-10-06-curl-and-web-fetch-reach-the-local-network.md). The rest of that decision stands: `curl`, `web_fetch`, and app requests reach the internet and the local network, loopback included.

## Context

The 2026-10-06 decision kept one refusal: Instrument's own workspace server, on the grounds that its routes were unaudited for a caller the agent controls. Refusing one host and port is something just-bash's `NetworkConfig` cannot express, so the shell got a fetch of our own (`sandbox-fetch.ts`) that followed redirects by hand to check every hop. That fetch re-sent `Authorization`, `Cookie`, and the request body on every hop whatever its origin, where just-bash's own fetch drops the credentials on a cross-origin hop. An agent's `curl -H "Authorization: Bearer …"` answered with a redirect handed the token to the next host.

The premise did not hold. Everything the workspace server answers already requires a secret the agent never holds:

- The model proxy requires the per-launch internal key (`ai-gateway/src/lib/auth-middleware.ts`, `key-for-provider.ts`); the sandbox environment carries only `NO_COLOR`, `TZ`, and `PATH`.
- The CDP bridge requires a per-launch secret in its path (`logic/server/cdp-bridge-path.ts`) and refuses any upgrade carrying an `Origin` header.
- Nothing else is mounted.

The refusal was also never a boundary: `node` and `python-native` reach the port directly, which the 2026-10-06 record said itself.

## Decision

The agent's HTTP tools refuse no address. The shell goes back to just-bash's own network config (`dangerouslyAllowFullInternetAccess: true`, `denyPrivateRanges: false`, the sandbox's body cap), which handles redirects, credential stripping, and method rewriting the way curl does. `web_fetch` and app requests drop their workspace-server check; app requests keep the https rule for non-loopback hops.

Whatever the workspace server serves guards itself with a secret handed only to its callers, so the protection holds against `node`, other local processes, and other users on the machine, not just against `curl`.

## Consequences

- `sandbox-fetch.ts` and `workspace-server-address.ts` are deleted, and the bash worker no longer needs the server's port.
- A route added to the workspace server must require a per-launch secret of its own, or sit behind one of the two above. An address check in the agent's tools is not the place to protect it.
- A request from the agent that reaches the workspace server gets a 401 or 403 and nothing else.

## Implementation

- [Shell network config](../../packages/workspace/src/lib/create-bash-env.ts)
- [Model proxy auth](../../packages/ai-gateway/src/lib/auth-middleware.ts)
- [CDP bridge secret](../../packages/workspace/src/logic/server/cdp-bridge-path.ts)
