# The asset origin

Every task gets its own HTTP origin that serves the files the agent can see. It is how a chat preview loads an image, how the file viewer renders a PDF, how an agent-authored page loads its own stylesheet, and how the agent's browser opens something the agent just wrote. One origin, four consumers, and no other way for a renderer or a browser to read a task's bytes.

The one-line model to hold: **the asset origin is a task's virtual filesystem over HTTP, not a task's folder over HTTP.** Those coincide today because the task's writable root is the task directory, but the route already resolves through the same layout the agent's file tools and bash sandbox use, and it already serves a mount that is nowhere near the task directory.

## The host is the routing key

The workspace server ([`server/index.ts`](../../packages/workspace/src/logic/server/index.ts)) is one Hono app on one loopback port. Which task a request is for, and whether it is an asset request at all, comes from the `Host` header, parsed by [`uri-details-for-host.ts`](../../packages/workspace/src/logic/server/uri-details-for-host.ts):

| Host                                    | Origin   | Serves                                     |
| --------------------------------------- | -------- | ------------------------------------------ |
| `assets.<taskId>.localhost:<port>`      | `assets` | The task's files, statically               |
| `<taskId>.localhost:<port>`             | `app`    | The app-runtime proxy (no UI navigates here) |

`lvh.me` is accepted alongside `localhost` for browsers that will not resolve `*.localhost`. `assetsRoute` claims its origin before any other route sees the request, so the two origins never contend.

The task id doubles as the DNS label, which is what forces [`TaskIdSchema`](../../packages/workspace/src/schemas/task-id.ts) to be a `SubdomainPart`: lowercase alphanumerics and hyphens, no dots, 63 characters or fewer.

## The path space is the virtual path space, with one root rewritten

[`assets.ts`](../../packages/workspace/src/logic/server/routes/assets.ts) builds the task's `WorkspaceFsLayout` from its stored state and resolves the request path through `resolveHostPath`, exactly as the file tools do. The only translation is at the root:

| URL path        | Virtual path      | Backed by                        |
| --------------- | ----------------- | -------------------------------- |
| `/output/a.png` | `/task/output/a.png` | The task directory            |
| `/mnt/Photos/cat.png` | `/mnt/Photos/cat.png` | An attached folder, read-only |
| `/skills/...`   | `/task/skills/...` | Not the `/skills` mount — the workspace skills mount is not served |

So the origin root is the task mount, and `/mnt` is carved out of it as a reserved prefix. That is a deliberate shape rather than an accident: it keeps root-relative references inside agent-authored HTML (`<link href="/style.css">`) working, and it is what the agent prompt teaches — attached folders are reachable "including from agent-authored HTML or CSS, where that absolute path is what lets the static asset origin resolve them" ([`main.ts`](../../packages/workspace/src/agents/main.ts)).

The reserved prefix has a shadowing hazard that has not bitten yet only because we own the directory: a real `mnt/` inside the task root is unreachable, since the longer mount point wins in `resolveHostPath`.

Directory requests resolve to `index.html` ([`serve-static.ts`](../../packages/workspace/src/logic/server/serve-static.ts), a pinned fork of `@hono/node-server`'s implementation). Range requests are answered, which is what makes video and PDF seeking work.

## Who builds the URLs

Three builders, one shape, and they must agree:

- **The renderer.** [`asset-base-url.ts`](../../apps/studio/src/client/lib/asset-base-url.ts) resolves the server origin once at boot so `getAssetBaseUrl(taskId)` is synchronous everywhere; [`get-asset-url.ts`](../../apps/studio/src/client/lib/get-asset-url.ts) joins a stored file path onto it and appends `?version=<mtimeMs>`. Consumers are the chat stream's file cards and image embeds, the file sidebar, and the file viewer.
- **The agent's browser.** [`agent-browser-asset-url.ts`](../../packages/workspace/src/lib/shell-commands/agent-browser-asset-url.ts) rewrites a navigation argument naming a sandbox path onto the same origin, so `agent-browser goto output/report.html` loads a real page rather than a `file://` path that does not exist on the host. Its `assetPathForVirtualPath` is the inverse of the route's root rewrite, and the pair has to stay in step.
- **The artifact preview.** Renders `getAssetUrl`'s output in a `<webview>` guest, so an HTML artifact runs as a **real origin** with storage and cookies, scoped to a per-task partition directory. See [in-app-browser.md](in-app-browser.md).

The agent and the human therefore load the same URL for the same file, which is what lets the agent's own screenshot count as evidence about what the user will see.

## Caching

`?version=<mtimeMs>` is a cache-busting parameter the client appends to any path. The route decides policy:

- Task files whose `version` matches the file's current mtime: `public, max-age=31536000, immutable`.
- Everything else, including every `/mnt` file regardless of `version`: `no-store`.

The split is "do we own the file." A file under a mount the user can edit outside the app has no reliable version to pin, so a mount version is inert by design.

## The governing invariant: the origin never exceeds the agent

Everything in the next section is mechanism. The rule the mechanism exists to enforce is this: **the origin serves exactly the mounts the agent can read, at exactly the paths the agent uses, and never more.** It has no path policy of its own — it resolves through the same `WorkspaceFsLayout` and gets the same answer.

That is what makes serving a user's real files defensible at all. A folder becomes readable over HTTP because the user attached it, in the same gesture that made it readable by the agent; there is no second grant to reason about and no way for the origin to drift wider than the consent that created it. It also means the URL the user sees and the path the agent writes are the same string, which is why an agent-authored page can link to its own siblings and to `/mnt` without knowing an origin exists.

The origin is deliberately narrower in two places, and narrower is fine:

- **Read only.** Only `GET` and `HEAD` reach a file; every other method 404s before resolution, so a writable mount is still read-only here.
- **No `/skills`.** The workspace skills mount is agent-writable but is not served; a request for `/skills/...` resolves into the task mount instead, and 404s.

## Containment

Four layers, each covering something the others do not:

1. **Traversal.** `.`/`..` segments, doubled slashes, and backslashes are rejected before anything resolves.
2. **The private dir.** `/.instrument` and everything under it is refused, case-insensitively, because the app runs on case-insensitive filesystems where `/.INSTRUMENT/task.db` names the same file. The rule is the exact directory, not a prefix glob, so a sibling like `.instrument-notes/` is a normal task file.
3. **Mount ownership.** A path no mount owns is a 404; there is no fallback root.
4. **Symlinks.** `hostPathEscapesMount` re-checks the resolved host path against its own mount's root after index resolution, and fails closed on anything other than a clean not-found.

## What it is not

**It is not authenticated, and it is not private to the app.** Every response carries `Access-Control-Allow-Origin: *`, task ids are human-readable and derived from the prompt, and the default port is fixed. Any local process, and any web page that can reach loopback, can read a task's files if it can name the task. See [asset-origin-is-open-to-any-local-reader](../findings/asset-origin-is-open-to-any-local-reader.md) for the full shape and what would close it.

## Related

- [system-overview.md](system-overview.md) — where the workspace server sits.
- [agent-sandbox.md](agent-sandbox.md) — the layout the route resolves through, and the native-binary bridge that does not.
- [in-app-browser.md](in-app-browser.md) — the guest that loads this origin as a real origin.
- [user-chosen-working-folder.md](../plans/active/user-chosen-working-folder.md) — what changes here when the working directory stops being the task directory.
