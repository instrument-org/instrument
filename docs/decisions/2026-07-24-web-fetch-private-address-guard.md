# web_fetch blocks private addresses to match the sandbox

## Context

`web_fetch` is a new tool that fetches an arbitrary http(s) URL and pipes the result into the model's context. Unlike the agent's other HTTP path -- `curl`, which runs inside the just-bash sandbox -- `web_fetch` executes in the Electron main process with no sandbox around it.

The sandbox already refuses private, loopback, and link-local ranges: `create-bash-env.ts` sets `denyPrivateRanges: true`, "enforced even when the dangerously-allow flag is on." Verified in the run-bash sandbox, `curl http://127.0.0.1:9999/`, `http://169.254.169.254/...`, and `http://10.0.0.1/` all fail immediately with "Network access denied: private/loopback IP address blocked," while a public address succeeds.

So without a guard of its own, `web_fetch` would have been the one built-in HTTP path that could reach `localhost`, cloud metadata (`169.254.169.254`), and RFC1918 hosts that `curl` cannot -- reachable by any URL the model is handed, including URLs embedded in previously-fetched, explicitly-untrusted page content.

## Decision

`web_fetch` validates the resolved address of every request against private/loopback/link-local ranges before connecting, and follows redirects manually so each hop is re-validated (and non-http(s) redirect targets are rejected). The range list lives in `lib/private-address.ts` (`net.BlockList` over loopback, `0.0.0.0/8`, RFC1918, CGNAT `100.64/10`, link-local incl. metadata, and the IPv6 equivalents, with IPv4-mapped-IPv6 normalized).

This deliberately mirrors the sandbox's `denyPrivateRanges` posture so the two built-in HTTP tools behave the same. We do not lose anything relative to `curl`: it already refuses these ranges. We close a gap where `web_fetch` was _less_ restricted than `curl`.

## Consequences

**This is not a containment boundary.** The guard covers the two tools the model reaches for -- `curl` (via the sandbox) and `web_fetch` (via this code) -- and nothing more. Agent-authored code can still reach private addresses: verified in the sandbox that `python3 urllib` and Node `fetch` to `http://127.0.0.1:9999/` return `Connection refused` / `ECONNREFUSED` (i.e. they reach loopback; the port is just closed), not the "blocked" that `curl` returns. The sandbox's range block is applied at the `curl` shim, not at the socket layer, so a script that opens a raw socket is not stopped by it, and neither is `web_fetch`'s guard something such a script goes through.

What the guard is worth, then, is removing the _easy and accidental_ route, and the most plausible injection route: fetched web content that says "now fetch `http://169.254.169.254/...`" gets refused by the tool the model would naturally use, instead of quietly succeeding. Making the unsafe path require deliberately writing socket code raises the signal and drops the accident rate. It is defense-in-depth and consistency with `curl`, not a wall.

**Residual gap:** DNS rebinding. The check resolves a hostname and validates the address, then `fetch` resolves again to connect; a name that re-resolves to a private address in between is not defended against. The obvious "check at connect time" fix is a custom `lookup` on an undici dispatcher, and it was tried and rejected: (1) the installed `undici` package's `Agent` is incompatible with Node's bundled global `fetch` (`UND_ERR_INVALID_ARG`), so it would force `web_fetch` onto undici's own `fetch`; and (2) even then, undici does not call the custom `lookup` for IP-literal URLs, so `http://127.0.0.1/` and `http://169.254.169.254/` would connect straight through -- the exact cases the pre-flight check already blocks. So the pre-flight resolve-and-check is the more complete guard for the routes that matter (literal private IPs and hostnames that resolve to them), and the remaining hostname-rebinding TOCTOU is accepted as a limitation, consistent with the sandbox's own pre-connect "DNS check" posture and with this control being defense-in-depth rather than containment. For the same reason the check fails open on a lookup error (an unresolvable host is not reachable, so `fetch` fails on its own with an honest error), rather than fail closed with a misleading "private address" message.

**Product note:** if we ever want the agent to reach a user's own `localhost:3000` dev server, that is blocked today in _both_ `curl` and `web_fetch` by design. Enabling it is a deliberate change to the `denyPrivateRanges` policy across both paths, not a `web_fetch`-specific exception. Legitimate interaction with the user's in-workspace app already goes through agent-browser against the workspace-served origin, not an arbitrary loopback fetch.

## Implementation

- [Private address guard](../../packages/workspace/src/lib/private-address.ts)
- [web_fetch tool](../../packages/workspace/src/tools/web-fetch.ts)
- [Sandbox network policy](../../packages/workspace/src/lib/create-bash-env.ts) (`denyPrivateRanges`)
- Carried by PR #72.
