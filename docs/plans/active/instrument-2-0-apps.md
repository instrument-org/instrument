# Plan: Apps in the Instrument 2.0 prototype

Status: first version built and running behind developer mode; the pieces table below is what the code does. Builds on the orchestrator spike ([instrument-2-0-prototype.md](instrument-2-0-prototype.md)) and takes its runtime from the unmerged connectors prototype (`jmack/connectors-v2`). Design context is the "Instrument 2.0 - Prototype Handoff" note, the app-pages wireframe set ("all your apps", "connecting by asking", "the agent navigates", "an app with a website", "an app without a website"), and [Plugins over connectors](../../decisions/2026-08-15-plugins-over-connectors.md).

## What it is

An **app** is a service the user's agent can reach programmatically: Notion, Linear, GitHub, a REST API nobody has heard of. The user never configures one. They click a button on the Apps screen, or say "connect Notion", and Instrument does the rest: it looks the service up, writes the app's folder, asks for the one thing only the user can give (a sign-in, or a key), tests the connection until it works, and then uses it, itself for one-step questions and through tasks for longer work. Once connected, an app is a first-party place in the product: a row in the directory, a page of its own, a line in the sidebar, and a context chip when the user asks about it from its page.

The vocabulary is "Apps" everywhere (never connectors, plugins, services, or MCP servers in anything the user sees). On disk an app is a folder under the workspace's `apps/`, mounted for the agent at `/apps/<slug>/`.

## What the connectors branch already solved

`jmack/connectors-v2` (nine commits on a 2026-07-31 base, never merged) is a complete worked example of the agent-authored setup loop, and most of it moves over unchanged apart from the rename:

- A strict manifest (`api` with `baseUrl` + `bearer|header|query|none` auth, or `mcp` with `url` + `bearer|header|none|oauth`), written by the agent with the file tools, validated by a test that is the only way a connector turns on.
- `guide.md` beside it, gated: the first request in a task returns the guide instead of calling, so endpoint knowledge lives in a file rather than in every tool description.
- A request path with SSRF guards on every hop (public-address check after DNS, credentials dropped on a cross-origin redirect, size cap), and the same guard on the MCP URL.
- MCP over Streamable HTTP through the official SDK: list tools, call a tool, results wrapped as untrusted content, the credential redacted from anything the model sees.
- OAuth for MCP through the SDK's provider contract: discovery, dynamic client registration as a public client with PKCE, tokens and registration in an Electron `safeStorage` store, a parked in-flight transport keyed by `state`, a loopback callback route that finishes the exchange, refresh handled inside the SDK.
- A secret scan over the folder before enabling, a credential store the model never reads from, two interactive tools (a secure key field, a Connect button) that resolve with only granted/denied or connected/dismissed.
- A catalog seed of thirteen services (GitHub, Google Workspace, Linear, Notion, PostHog, Resend, Sentry, Shopify, Slack, Spotify, Stripe, Todoist, Vercel) with interfaces, endpoints, and auth methods.

What it got wrong, and this plan changes: `enabled` lived in the agent-writable manifest, so the test was skippable (recorded in the branch's own finding); the OAuth redirect was built from the default port constant while the server binds a fallback port; the interactive prompts parked the whole turn; user-started setup abandoned the task it came from; nothing surfaced the catalog to the agent; and nothing put a connection anywhere in the product except Settings.

## Decisions

**The connection is a record the agent cannot write.** `app.json` describes how to call a service and carries no `enabled`. Whether it may be called is a connection record in the app's own store (Studio, `safeStorage`): connected at, the hash of the manifest that passed, the account when the service tells us one. A call refuses when the current manifest's hash is not the one that passed, so editing a manifest means testing it again, and self-enabling is impossible rather than discouraged.

**One command for everything programmatic: `app`.** A custom command in the sandbox shell, in the orchestrator's and in a task's, doing its network work host-side behind the branch's guards, so it needs no `curl` and the orchestrator's shell stays network-free. `app catalog`, `app new`, `app test`, `app list`, `app tools`, `app call`, `app request`, `app guide`. The agent iterates with it the way it iterates with `task`: write, test, read the failure, fix, test again.

**Elicitation is a card, and the answer arrives as a wake.** The user asked for an asynchronous flow, and the vault is explicit that the agent has to be told once the user signs in. So `connect_app` does not park the turn. It puts a card in the conversation and returns at once; the agent says one line and stops, the way it does after `task new`. When the user signs in (the loopback callback lands), saves a key, or says not now, the app store publishes an event and the orchestrator is woken with a `data-appEvent` note, exactly as a finishing task wakes it. The user can keep talking in between; nothing is blocked on the card.

**Sign-in happens in our browser.** The card's Sign in button opens the provider's authorization page in the window's Browser screen, in a tab, and the callback page lands in that same tab. "Open in your browser" is the secondary option behind a chevron, never the default. The redirect URL is built from the port the callback server actually bound.

**Prefer MCP, keep HTTP.** Where the catalog has an MCP endpoint (Linear, Notion, GitHub, Sentry, ...) the agent writes an `mcp` app and OAuth does the rest with no key. Services without one get an `api` app and a key. Services that need a client we do not hold (Slack, Google) the agent says so plainly rather than pretending; those are the next rung, not this one.

**Prompt buttons are the product's calls to action.** Every button on the Apps screen is a message: "Connect Notion", "Ask about Linear", "Finish connecting GitHub". A glyph button (white, the green Instrument mark, a verb) sends its words to the conversation and opens it. Nothing on the screen runs on its own; the agent does everything.

**Tasks get the apps the goal needs.** `task new --app <slug>` hands a connected app to a task, which then has the `app` command scoped to that app and nothing else. An app the orchestrator did not pass is not there.

**Left for later, on purpose:** the Agent Plugins directory layout (`plugin.json` + `mcp.json` + a namespace directory) that the decision record settled on; the prototype uses one `app.json` per folder so the agent authors the smallest possible format, and the layout can be adopted when the loop is proven. Also later: pre-registered client identities and client ID metadata documents, local stdio MCP servers, connection pooling, per-app guidance the agent maintains, Settings as the home of status and Disconnect (the app page carries them in the prototype), and connected web apps opening as themselves under a badge.

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Mount and layout | `mount-points.ts` (`apps: "/apps"`), `workspace-fs-layout.ts` | The workspace's `apps/` directory, created on demand, mounted writable for the orchestrator and for any task that was handed an app. Secrets never live in it. |
| Manifest and store | `lib/apps/manifest.ts`, `lib/apps/store.ts` | The branch's schema minus `enabled`, renamed: `app.json` with `name`, `type`, `url` or `baseUrl`, `auth`, optional `headers` and `test`. Load, list, read the guide, hash the manifest. |
| Connection record | Studio `stores/app-connections.ts`, `WorkspaceConfig.apps` | Per slug: `connectedAt`, `manifestHash`, `account?`, `status` (`connected`, `needs-sign-in`, `needs-key`, `failed`). Written by a passing test or a finished sign-in; read by every call. The workspace reaches it through the config, never the file. |
| Credentials and OAuth | Studio `stores/app-credentials.ts`, `stores/app-oauth.ts`; `lib/apps/mcp/oauth-flow.ts`, `oauth-provider.ts` | The branch's encrypted stores and SDK provider, renamed. The redirect URL comes from the bound callback port. The callback route is `/auth/callback/app`. |
| Guards and transport | `lib/apps/safe-url.ts`, `request.ts`, `secret-scan.ts`, `mcp/client.ts` | Moved over as they are. |
| The test | `lib/apps/test-app.ts` | Manifest, guide, credential or tokens, secret scan, canary (MCP: connect and list tools; API: the test path). A pass writes the connection record with the manifest hash. |
| The `app` command | `lib/shell-commands/app.ts` | `catalog [query]`, `new <slug> --name --mcp <url>|--api <base> [--auth ...] [--header K=V] [--test <path>]`, `test <slug>`, `list`, `tools <slug>`, `call <slug> <tool> [json]` (args on stdin through a heredoc, like `task`), `request <slug> <METHOD> <path> [--param k=v] [body on stdin]`, `guide <slug>`, `disconnect <slug>`. In a task, scoped to the apps it was handed. `request` returns the guide first, once per task. |
| `connect_app` | `tools/connect-app.ts`, `message-part/tool-connect-app.tsx` | Input: slug and one sentence for the user. Reads the manifest, decides sign-in or key, records `needs-sign-in` or `needs-key` on the connection, returns at once. The card: the app's icon, "Sign in to Notion" or "Notion needs an API key", the sentence, a glyph Sign in button or a password field with Save, and Not now. Its live state (waiting, connected as ..., declined) comes from the connection record, not the part. |
| The wake for apps | `lib/orchestrator/wake.ts` (`wakeOrchestrator` generalized), `lib/apps/events.ts`, `data-appEvent` | Studio publishes `apps.event` when a sign-in completes, a key is saved, the user declines, or an app is disconnected; the workspace turns it into a `data-appEvent` part on a text-less user message in the orchestrator's session, with a model note ("The user signed in to Notion; it is connected with 12 tools") and a product-event line in the transcript. |
| The turn rule | `agents/instrument.ts` `shouldContinueAfterHandingOff` | A step that called `connect_app` gets one more step for the line, then the turn ends. |
| The prompt | `agents/instrument.ts`, `agents/main.ts` | An Apps section: what an app is, the `app` command, the loop (catalog, write, connect, wait for the note, test, use), never a key in prose, never a credential in a file, what an unauthorized call means (connect again), `--app` on `task new`. The apps the workspace has, with status, ride in the context message; `app list` is ground truth after that. The working agent gets a short paragraph only when its task was handed an app. |
| Task hand-off | `lib/shell-commands/task.ts`, `schemas/task-settings.ts` (`apps`) | `--app <slug>` on `new`; the child's bash env gets `app` scoped to those slugs. |
| RPC | Studio `rpc/routes/apps.ts` | `list`, `live.list`, `catalog`, `tools(slug)`, `startOAuth(slug)` (returns the authorization URL rather than opening it), `cancelOAuth`, `setCredential`, `dismiss(slug)`, `disconnect(slug)`, `remove(slug)`. |
| The Apps screen | `routes/orchestrator/apps.tsx` | The rows directory from the wireframe: **Connected** (icon, name, account or when, an Ask glyph button that opens the app's page with the conversation), **Setting up** (apps in the folder with no connection yet, with their status and a Continue button), **More** (the catalog, each with a Connect glyph button), and a last row to connect something not listed, which sends "Connect <name>". |
| An app's page | `routes/orchestrator/apps/$slug.tsx` | Crumb back to Apps, icon, name, domain, description; a Connect glyph button until it is connected, then the status (as whom, since when) and Disconnect; "What it can do" as the tool list once connected and the catalog's interfaces before; "Needs" as the auth method; a link that opens the service's site in the Browser. |
| What is on screen | `on-screen.ts`, `view-context-model-text.ts`, `conversation-chrome.tsx` | The Apps screen says which app's page is up and its status; the composer chip carries the app's icon and name; "this app" and "it" mean it. |
| Sidebar, Home, omnibox | `sidebar.tsx`, `home.tsx` | The Pinned fixtures become an Apps section of connected apps, each opening its page. Home gets an Apps row of glyph buttons (connect the first few, ask about the connected). The omnibox's Apps group lists connected apps and the catalog. |
| Glyph button | `components/orchestrator/glyph-button.tsx` | The product's call to action: white, the green mark, a verb; its words are the message. |
| Icons | `Favicon` through the proxy by the app's domain | No brand tiles; the site's own icon. |
| Links | `external-link.tsx`, a window-level open context | In the orchestrator window, "Open in Instrument" on a link opens the window's Browser tab, not the orchestrator task's own pane that this window never shows. |

## The flow, as the user sees it

1. Apps screen. Notion is under More with a Connect button. Click.
2. The conversation opens with "Connect Notion" as the user's message. Instrument: "Setting up Notion." It runs `app catalog notion`, writes `/apps/notion/app.json` (mcp, the catalog's endpoint, oauth) and a guide, then calls `connect_app`. A card: Notion's icon, "Sign in to Notion", one sentence, Sign in, Not now. Its turn ends.
3. Sign in. The Browser screen comes up on Notion's authorization page. Approve. The tab lands on our callback page; the card says "Connected as ...".
4. Instrument wakes on the note, runs `app tools notion`, and says "Notion is connected: 12 tools, search, pages, databases. Ask me anything in it." Notion has moved to Connected on the Apps screen, has a page, and is in the sidebar.
5. "What did I write in Notion this week?" From Notion's page or anywhere. One `app call notion search ...` by Instrument itself, an answer in a sentence. "Summarize every page in the Research space into one doc" becomes a task with `--app notion`.
6. A key-based service (Resend, PostHog): the same, with a password field on the card instead of a button, and `app test` after the note.
7. Something unlisted: "Connect the Whoop API." Instrument researches it in a task or from what it knows, writes the manifest by hand, and the loop is the same.

## Order of work

1. Workspace library and command: mount, manifest, store, guards, request, MCP client, test, `app` command, `connect_app`, `data-appEvent` and the wake, prompt sections. Unit tests ported from the branch for the manifest, the URL builder, the request path, the OAuth flow and provider, the test. The command exercised through the sandbox shell against a loopback MCP server with no auth (rung 2).
2. Studio main: the three stores, the RPC routes, the callback route, the workspace config wiring, the SDK dependency.
3. The card, the event line, the glyph button, the Apps screen, the app page, the view context, sidebar and Home.
4. Task hand-off and link opening.
5. A run in the app on the free Cloudflare model: a loopback MCP app end to end; Notion and Linear as far as their authorization pages, since finishing needs the user's own sign-in.

## What the runs showed

In the sandbox shell against a loopback MCP server with no auth: `app new`, `app test` (five checks, two tools found), `app tools`, and two `app call`s, each result inside its nonce boundary, in one process.

In the app, on the free Cloudflare model, with the same loopback server: "Connect the MCP server at 127.0.0.1:47911/mcp as an app called local, no sign-in" became `app new`, `app test`, `app tools`, and a two-line answer naming both tools, in eight seconds; the Apps screen moved Local to Connected as it landed, the sidebar gained an Apps row, and its page showed the two tools under "What it can do".

Connect on Notion's row in the directory sent "Connect Notion"; the orchestrator ran `app catalog notion`, wrote the folder with the catalog's MCP endpoint, called `connect_app`, said one line, and ended its turn. The card drew with Notion's icon, the reason, a glyph Sign in and Not now; Notion moved under "Setting up: Needs a sign-in". Sign in registered a client with Notion's MCP server, switched the window to the Browser screen on Notion's login page, and the card read "Waiting for the sign-in" with Cancel. Finishing the sign-in needs the user's own account, so the callback, the connected event, and the wake that follows were exercised only against the loopback server and the key path.

The next morning, with the user's own account: the Notion sign-in finished in the window's browser, the callback connected it with 42 tools, and the wake reply was one line; "latest doc?" was two calls in eleven seconds; "add one agenda item" fetched the page and updated it in place through the app rather than the browser it was open in. Linear connected the same way with 61 tools. What the morning found: the directory's Continue button sent the agent a second request to draw a card the folder already justified, so a row or page waiting on a sign-in or a key now carries the controls itself; Cloudflare was not in the directory and the agent guessed a product-scoped endpoint, so Cloudflare is listed and an unknown service is researched by a task rather than guessed; with Linear connected and a Linear issue on screen, "add a comment here" went through the browser and hijacked the tab a sign-in was waiting on, so the prompt puts a connected app ahead of the page and leaves sign-in tabs alone; and the orchestrator was told a browser tab had closed when the user had only switched tabs, since a task's browser-status note does not describe a window's tabs, so the orchestrator no longer gets one.

## Open

- Slack and Google refuse dynamic registration; connecting them needs a client we hold. The prototype says so honestly. The ladder in the plugins plan is the answer.
- The sign-in callback page stays open in the tab it landed in; closing that tab when the card settles is a small addition.
- An app's `guide.md` is a skeleton until the agent fills it in; nothing yet nudges it to.
- The OAuth callback tab stays open on our landing page; closing it when the card resolves is a small addition.
- Connected web apps as themselves under a badge, and the account address as the sidebar row's name, are drawn in the wireframes and not built here.
- An app's activity (its tool calls, by task) is the idea the wireframes liked most for apps without a site; nothing indexes it yet.
- Whether `request`'s guide gate should apply to `call` too; MCP tools are self-describing, so the prototype gates only HTTP apps.
- The catalog is the branch's seed; a live layer over a public index is the same shape later.
