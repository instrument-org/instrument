# The asset origin is readable by anything that can name a task

**Status:** open — no mitigation in place. Recorded because the exposure is bounded today and stops being bounded under [user-chosen-working-folder](../plans/active/user-chosen-working-folder.md).

## What is true

The per-task asset origin ([asset-origin.md](../architecture/asset-origin.md)) serves files over plain HTTP with no authentication of any kind, and four properties compound:

1. **Wildcard CORS.** [`assets.ts`](../../packages/workspace/src/logic/server/routes/assets.ts) applies bare `cors()`. Hono's default is `origin: "*"`, so every response carries `Access-Control-Allow-Origin: *` and any web origin can read the body, not merely issue the request. A `GET` needs no preflight.
2. **Guessable task ids.** [`generate-task-folder-name.ts`](../../packages/workspace/src/lib/generate-task-folder-name.ts) derives the id from the date and a slug of the user's first prompt (`2026-06-23-add-a-dark-mode-toggle`). It is a human-readable name, not a secret, and it is the whole of the origin's identity.
3. **A known port.** The default is fixed (`PORTS.appsServer`), and the fallback-to-free-port path only triggers when it is taken.
4. **Loopback resolves from anywhere.** `*.localhost` resolves to 127.0.0.1 in every current browser, and `lvh.me` is accepted as a second domain for the ones that do not.

So `fetch("http://assets.<guessed-id>.localhost:<port>/output/report.pdf")` from an arbitrary web page returns readable bytes. Binding to loopback ([`constants.ts`](../../packages/workspace/src/logic/server/constants.ts)) keeps the local network out; it does nothing about the local machine or about a page the user has open.

Any local process is unconstrained by even the browser mitigations, which [loopback-block-is-curl-only](loopback-block-is-curl-only.md) already records for these routes generally.

## Why it is bounded today, and stops being

Today an attacker who wins this reads the task directory plus whatever folders the user explicitly attached to that task. That is agent-produced work and material the user deliberately handed over, which is why this has not been urgent.

Two in-flight changes remove both bounds, and neither does it alone:

- **[user-chosen-working-folder](../plans/active/user-chosen-working-folder.md)** makes the origin's root a folder the user picked — plausibly a source repository with `.env`, deploy keys, and customer data, or a whole documents directory. The reader no longer gets our scratch; it gets the user's real files.
- **Moving HTML artifacts from the sandboxed iframe into a `<webview>` guest** ([html-artifact-iframe-navigation](html-artifact-iframe-navigation.md)) loads agent-authored HTML as a **real origin** on that host, with network access, in place of today's opaque origin. Under the folder plan that page is same-origin with the entire working folder, so `fetch("/.env")` needs no CORS grant at all, and the fetch-then-POST pair runs the next time a human opens a preview. The HTML that does it need not be something the agent intended to write: a prompt-injected instruction in a `/mnt` source is enough.

The combination is the thing to notice. Each plan is individually defensible against its own threat model.

## What would close it

Roughly in ascending cost, and the first two are most of the value:

- **An unguessable component in the origin.** A per-boot random label (`assets.<token>.<taskId>.localhost`) turns "name a task" into "hold a secret the app never publishes". The change is confined to `buildAssetBaseUrl` and `uriDetailsForHost`; relative and root-relative references inside artifacts are unaffected because only the base changes. This is the single highest-value fix and it composes with everything below.
- **Drop the CORS wildcard.** The renderer is the only cross-origin reader that needs it, and its origin is known. The artifact guest's sibling fetches are *same-origin* and need no grant, so locking `origin` down costs nothing there. Already flagged for an unrelated reason in [dependency-upgrade-sweep](../plans/active/dependency-upgrade-sweep.md) (GHSA-88fw-hqm2-52qc); the folder work is what makes it load-bearing rather than hygiene.
- **Separate "render as data" from "execute as a page."** Give the artifact guest an origin whose root is narrower than the working folder, so an executing artifact cannot read the whole folder same-origin. Expensive, and largely redundant once the token lands, since the artifact would still have to be told the token — which it is, by being loaded from it. Worth revisiting only if artifacts ever become shareable.
- **Apply the file index's ignore rules to the route.** Weak, easy to get subtly wrong, and it protects the wrong axis (noise, not secrets). Not a substitute for the above.

## What this is not

Not a claim that the agent itself is contained. The agent has bash, real binaries, and network access; it can already read the working folder and send it anywhere. The exposure here is different in kind: it is reachable **without the agent**, by code the user never invited, at a time no agent is running.
