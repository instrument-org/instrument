# The loopback block stops curl, not native interpreters

**Status:** resolved by lifting the block rather than enforcing it: `curl` and `web_fetch` reach the whole local network and refuse only Instrument's own workspace server ([decision](../decisions/2026-10-06-curl-and-web-fetch-reach-the-local-network.md)). The record below describes the block as it stood, which is why it went.

## Context

`create-bash-env.ts` paired `dangerouslyAllowFullInternetAccess: true` with `denyPrivateRanges: true`, described in place as "SSRF block: loopback/RFC1918/metadata, with DNS check + redirect re-check. Enforced even when the dangerously-allow flag is on."

The intent was to refuse the obvious injection route: fetched web content that says "now request `http://169.254.169.254/...`" or "now request `http://localhost:3000/`" should not quietly succeed.

This has been investigated twice (once while adding an unsandboxed fetch tool, once while adding background shell processes, each time reaching for the same evidence), so the verified behavior is recorded here rather than in a branch.

## What we found

**The block is applied at the `curl` shim, not at the socket layer.** Anything that opens a real socket goes around it. Reproduced in one sandbox session via `pnpm --silent script:run-bash`:

```
curl    http://127.0.0.1:9999/   ->  exit 7, "Network access denied: private/loopback IP address blocked"
python3 urllib -> 127.0.0.1:9999 ->  URLError: [Errno 61] Connection refused
node    net.connect(9999, ...)   ->  ECONNREFUSED
```

`Connection refused` and `ECONNREFUSED` are the tell: those come back from loopback itself on a closed port, so the connection arrived. Only `curl` is refused before it leaves. This is the same "real-binary escape hatch" that `docs/architecture/agent-sandbox.md` describes, and the same shape as the private-dir mask (see Related).

**The range covered is the whole private space, not just loopback.** `192.168.1.1` and `169.254.169.254` are refused identically to `127.0.0.1`, while a public GET returns 200 and a public POST reaches the origin. Egress to the public internet is unrestricted in both directions by design (`dangerouslyAllowFullInternetAccess`); the range check is the only network restriction in place.

**Blocking `curl` covers more of the easy path than it appears to, because `curl` is the only preinstalled HTTP client.** Inventoried in the same session: `curl`, `python`, `python3`, and `node` are present; `wget`, `nc`, `netcat`, `telnet`, `ssh`, `perl`, and `ruby` are all absent. So reaching a private address is not one flag away, it takes deliberately writing socket code in one of the two interpreters. That gap between "one command" and "a script" is the entire value of the control, and it is worth preserving when adding commands to the sandbox: shipping a `wget` or `nc` without the same range check would quietly undo it.

**The refusal is legible to the model, contrary to a claim worth not repeating.** `curl` writes a specific, actionable line naming the address, on stderr, and `bash.ts` joins stdout and stderr into the single `output` field the model reads. Verified by suppressing it: `curl http://127.0.0.1:9999/ 2>/dev/null` prints nothing and still exits 7, which places the message on the sandboxed command's own stderr rather than on a host stream that gets dropped. A bare exit 7 shows up only when the agent passes `-s`.

**What is actually listening on loopback is narrower than it looks.** The workspace server binds `LOOPBACK_HOST` and mounts the AI gateway, but the gateway is authenticated: `createAuthMiddleware` requires an internal key, and that key is a per-process `randomBytes(32)` value, not a build-time constant. The sandbox environment is seeded with only `NO_COLOR`, `TZ`, and `PATH`, so the key is not in the agent's environment to find. Provider credentials are therefore not one raw socket away.

What a native interpreter reached, unaudited: the workspace server's other route (the CDP bridge), other tasks' dev servers, and whatever the user happens to be running locally.

## How it was resolved

An OS-level network boundary around the sandbox, the only thing that would have made the block real, is a different class of change than a flag, and nothing in the architecture provides it. Scoping loopback to a task's own ports needs port attribution per task, which does not exist either.

So the block went the other way: the tools the agent reaches for first reach what the native interpreters already could. A refusal of the workspace server's own port was kept at first and then dropped, since both of that server's routes already require a per-launch secret ([decision record](../decisions/2026-10-10-the-workspace-server-guards-itself.md)).

## Guidance

- The agent can reach the workspace server's port with any tool. A route added there must require a per-launch secret of its own, the way the model proxy and the CDP bridge do; an address check in the agent's tools would not protect it.

## Related

- `packages/workspace/src/lib/create-bash-env.ts` — the shell's network config, and the env allowlist that keeps the gateway key out of the sandbox.
- `packages/workspace/src/tools/bash.ts` — joins stderr into model-visible output.
- `packages/ai-gateway/src/lib/auth-middleware.ts` and `key-for-provider.ts` — why loopback exposure of the gateway is not credential exposure.
- `docs/findings/private-dir-masking-is-not-a-boundary.md` — the same friction-not-a-boundary shape, same underlying cause.
