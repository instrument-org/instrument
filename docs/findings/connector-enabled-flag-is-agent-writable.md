# A connector's `enabled` flag lives where the agent can write it

**Status:** open — known gap, accepted for v1. Recorded 2026-07-31.

## Context

`connector_test` is described everywhere as the thing that turns a connector on: it validates the manifest, scans the folder for embedded secrets, fires a canary request against the real service, and only then flips `enabled`. The agent prompt says "a pass is what enables the connector; nothing else does", and `runConnectorTestAndEnable` calls itself "the single enablement path".

That is the intended path, not an enforced one.

## What we found

`enabled` is a plain boolean field in `connector.json`, and `connector.json` lives in the `/connectors` mount, which is writable by design so the agent can author connectors with the ordinary file tools. The request tools gate on it directly (`if (!connector.manifest.enabled)` in `connector-request.ts`), reading the value straight back out of the agent-writable file.

So an agent can skip the test entirely by writing `"enabled": true` itself. Three routes, and the guard covers none of them:

- `write_file` of a **new** `connectors/<slug>/connector.json`. `guardConnectorManifestOverwrite` only refuses writes over a connector that is _already_ enabled, so a first write with the flag set sails through.
- `edit_file` flipping `false` to `true`. The guard runs only for `oldString === ""` (whole-file rewrite); targeted edits are deliberately the blessed way to change a manifest.
- Plain bash: `echo '{...}' > /connectors/x/connector.json`. No guard runs on the mount at all.

The last one is the reason this cannot be fixed at the tool layer. `/connectors` is a writable mount, so any check bolted onto `write_file` and `edit_file` is a guardrail against a confused agent, not a boundary against a determined one.

What that costs: the secret scan and the canary request are both skippable. The scan is what would catch a credential the agent pasted into `connector.json` (a hardcoded `Authorization` header, say) — static manifest headers are sent verbatim on every request and are never re-checked at request time. The canary is what would catch a connector that is merely wrong.

This is not a privilege escalation. Self-enabling gets the agent a connector it authored, pointed at a service it chose, and the credential store still refuses to hand it anything the user has not entered for that slug. The exposure is that a connector can go live without the checks that were supposed to precede it.

## What would actually close it

Stop treating the manifest as the source of truth for enablement. The credential store already holds per-slug state the agent cannot reach; enablement belongs alongside it, with `connector.json` describing only _how_ to call the service and the app deciding _whether_ it may be called.

A smaller version that keeps the file as-is: have `connector_test` record a hash of the manifest it passed, and have the request tools refuse when the current manifest does not match a hash that passed. That is tamper-evidence rather than tamper-proofing — the agent still cannot forge it, because the store is outside the mount — and it also catches the more ordinary case of a manifest edited after it was validated.

Either version means the settings UI and the RPC list read enablement from the store rather than from the manifest, which is why it was not done inside the v1 branch.

## Related

- `docs/findings/loopback-block-is-curl-only.md` — the same shape of gap: a control enforced at the tool layer that a real binary walks around.
- `docs/architecture/agent-sandbox.md` — what the writable mounts are and are not.
