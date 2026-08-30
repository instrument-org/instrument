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
| `/mnt/Photos/cat.png` | `/mnt/Photos/cat.png` | An attached folder |
| `/project/logo.png` | `/project/logo.png` | The folder of the task's project |
| `/skills/...`   | `/task/skills/...` | Not the `/skills` mount — the workspace skills mount is not served |

So the origin root is the task mount, and every mount point outside it is carved out as a reserved prefix. Each such mount has to be listed here as well as in the layout: resolving the layout is not enough on its own, because a prefix this route does not recognize is read as task-relative and looked for inside the task folder, which 404s as if the file were missing rather than as if the mount were unserved. That is a deliberate shape rather than an accident: it keeps root-relative references inside agent-authored HTML (`<link href="/style.css">`) working, and it is what the agent prompt teaches — attached folders are reachable "including from agent-authored HTML or CSS, where that absolute path is what lets the static asset origin resolve them" ([`main.ts`](../../packages/workspace/src/agents/main.ts)).

The reserved prefix has a shadowing hazard that has not bitten yet only because we own the directory: a real `mnt/` inside the task root is unreachable, since the longer mount point wins in `resolveHostPath`.

Directory requests resolve to `index.html` ([`serve-static.ts`](../../packages/workspace/src/logic/server/serve-static.ts), a pinned fork of `@hono/node-server`'s implementation). Range requests are answered, which is what makes video and PDF seeking work — and the CORS layer, applied only on this origin, exposes `Accept-Ranges` and `Content-Range` so a cross-origin reader can see that partial reads are answered and learn the whole file's size from a slice.

## Who builds the URLs

Three builders, one shape, and they must agree:

- **The renderer.** [`asset-base-url.ts`](../../apps/studio/src/client/lib/asset-base-url.ts) resolves the server origin once at boot so `getAssetBaseUrl(taskId)` is synchronous everywhere; [`get-asset-url.ts`](../../apps/studio/src/client/lib/get-asset-url.ts) joins a stored file path onto it and appends the caller's `?version=` (see Caching). Consumers are the chat stream's file cards and image embeds, the file sidebar, and the file viewer.
- **The agent's browser.** [`agent-browser-asset-url.ts`](../../packages/workspace/src/lib/shell-commands/agent-browser-asset-url.ts) rewrites a navigation argument naming a sandbox path onto the same origin, so `agent-browser goto output/report.html` loads a real page rather than a `file://` path that does not exist on the host. Its `assetPathForVirtualPath` is the inverse of the route's root rewrite, and the pair has to stay in step.
- **The artifact preview.** Renders `getAssetUrl`'s output in a sandboxed `<iframe>` (`sandboxed-html-iframe.tsx`) with `allow-same-origin` withheld, so agent-authored HTML runs at an **opaque origin** with no storage or cookies — and no readable location, which is part of why it has no navigation chrome. See [the finding](../findings/html-artifact-iframe-navigation.md); routing artifacts through the `<webview>` pool instead is future work. The agent's own browser, by contrast, loads this origin as a real origin in a `<webview>` guest ([in-app-browser.md](in-app-browser.md)).

The agent and the human therefore load the same URL for the same file, which is what lets the agent's own screenshot count as evidence about what the user will see.

## Caching

`?version=` is the client's claim about *which* bytes a reference is for. The route decides policy by whether it can check that claim:

- Task files whose `version` matches the file's current mtime: `public, max-age=31536000, immutable`.
- Everything else, including every file under a non-task mount (`/mnt` and `/project` alike) regardless of `version`: `no-store`.

The split is "do we own the file." A file under a mount the user can edit outside the app has no reliable version to pin, so a mount version is inert by design.

**`no-store` does not mean the next `<img>` fetches.** Blink keeps decoded resources in a per-document memory cache keyed by URL, and hands the same bytes to a second element naming the same URL without a network request at all — no revalidation, no conditional request, whatever the response said. Measured against this route's exact headers: a second `<img>` at an unversioned path never reached the server, while one carrying any distinct query string did.

So the query string is the only thing separating two references to one path, which is why it is not optional for a surface that draws the same path twice:

- A surface that watched or listed the file names its mtime, and is exact.
- A **transcript** surface never learned an mtime and must not go and ask for one (see [file-references-without-a-watcher.md](../plans/completed/file-references-without-a-watcher.md)), so it names the id of the message part that made the reference. Stable while that reply is on screen, distinct from the next reply's, and unverifiable by the route, so it earns `no-store` rather than a year.

Without that, an agent that rewrites a path and reports the change draws the file as it was before it — the later card serving the earlier card's picture.

## The governing invariant: the origin never exceeds the agent

Everything in the next section is mechanism. The rule the mechanism exists to enforce is this: **the origin serves exactly the mounts the agent can read, at exactly the paths the agent uses, and never more.** It has no path policy of its own — it resolves through the same `WorkspaceFsLayout` and gets the same answer.

That is what makes serving a user's real files defensible at all. A folder becomes readable over HTTP because the user attached it, in the same gesture that made it readable by the agent; there is no second grant to reason about and no way for the origin to drift wider than the consent that created it. It also means the URL the user sees and the path the agent writes are the same string, which is why an agent-authored page can link to its own siblings and to `/mnt` without knowing an origin exists.

The origin is deliberately narrower in two places, and narrower is fine:

- **Read only.** Only `GET` and `HEAD` reach a file; every other method 404s before resolution, so a writable mount is still read-only here.
- **No `/skills`.** The workspace skills mount is agent-writable but is not served; a request for `/skills/...` resolves into the task mount instead, and 404s.

## Containment

Four layers, each covering something the others do not:

1. **Traversal.** The path is fully percent-decoded first — Hono's own decode leaves the reserved set escaped, so `..` spelled `%2E%2E` once sailed past this check — and then `.`/`..` segments, doubled slashes, and backslashes are rejected before anything resolves.
2. **The private dir.** `.instrument` is refused as a path segment anywhere, case-insensitively, because the app runs on case-insensitive filesystems where `/.INSTRUMENT/task.db` names the same file. The rule is the exact directory name, not a prefix glob, so a sibling like `.instrument-notes/` is a normal task file. Matched anywhere rather than only at the root because more than one served mount has such a directory: the task's holds its database and state, and the project's holds the folders the project contributes and the access granted to each, which is worth more to an attacker than either. This route resolves host paths itself instead of going through the virtual filesystem, so [`maskPrivateDirFs`](../../packages/workspace/src/lib/mask-private-dir-fs.ts) — the mask that hides the same directories from the agent's shell — does not cover it, and this rule is the only thing in front of those files here. Any new mount inherits it; nothing else does it for you.
3. **Mount ownership.** A path no mount owns is a 404; there is no fallback root.
4. **Symlinks.** `hostPathEscapesMount` re-checks the resolved host path against its own mount's root after index resolution, and fails closed on anything other than a clean not-found.

## What it is not

**It is not authenticated, and it is not private to the app.** Every response carries `Access-Control-Allow-Origin: *`, task ids are human-readable and derived from the prompt, and the default port is fixed. Any local process, and any web page that can reach loopback, can read a task's files if it can name the task. See [asset-origin-is-open-to-any-local-reader](../findings/asset-origin-is-open-to-any-local-reader.md) for the full shape and what would close it.

## Related

- [system-overview.md](system-overview.md) — where the workspace server sits.
- [agent-sandbox.md](agent-sandbox.md) — the layout the route resolves through, and the native-binary bridge that does not.
- [in-app-browser.md](in-app-browser.md) — the guest that loads this origin as a real origin.
- [user-chosen-working-folder.md](../plans/active/user-chosen-working-folder.md) — what changes here when the working directory stops being the task directory.
