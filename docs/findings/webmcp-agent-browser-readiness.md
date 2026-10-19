# WebMCP: what it would take for the agent's browser to call a site's own tools

**Status:** working as of 2026-10-15. The blocker was the Electron upgrade and that has landed (44.4.5, Chromium 152), so all this took in the end was one switch. Driven end to end in the app against a local page and against a third-party site; see "What it took" below. What is left is a judgment call about the context the announcements cost, not a platform gap.

## Why this is here

[WebMCP](https://github.com/webmachinelearning/webmcp) lets a page hand an agent typed, described, callable tools instead of making it drive the UI. A site registers `search-flights` with a JSON Schema; an agent discovers it and calls it, and the page runs its own client-side code. For us the interesting direction is narrow and specific: **the agent's in-app browser calling tools that third-party sites publish**, as an alternative to `snapshot -i` plus `click`.

The other directions people reach for first are worth less to us and are not what this finding is about. Having Studio-generated apps register tools is nearly free but has no consumer until the browser side exists. Polyfilling our own previews reaches only pages we serve, which the agent can already drive.

## The API

The whole spec surface is one interface, and it is small enough to quote:

```
partial interface Document { [SecureContext, SameObject] readonly attribute ModelContext modelContext; };

interface ModelContext : EventTarget {
  Promise<undefined> registerTool(ModelContextTool tool, optional ModelContextRegisterToolOptions options = {});
  Promise<sequence<RegisteredTool>> getTools(optional ModelContextGetToolOptions options = {});
  Promise<DOMString> executeTool(RegisteredTool tool, optional object inputObject = {}, optional ModelContextExecuteToolOptions options = {});
  attribute EventHandler ontoolchange;
};
```

There is also a declarative form: `<form toolname tooldescription toolautosubmit>` synthesizes an input schema from the form's controls. That synthesis is a browser feature, which matters below.

Agents outside the page reach the same registry through a Chromium **CDP domain**, which is the part that fits our architecture, because a CDP connection to the guest is exactly what the agent already has.

```
WebMCP.enable / disable
WebMCP.invokeTool { frameId, toolName, input }  ->  { invocationId }
WebMCP.cancelInvocation { invocationId }
events: toolsAdded, toolsRemoved, toolInvoked, toolResponded
```

## Platform support, probed rather than read

Both rows below were measured by loading a page over `http://localhost` in a `BrowserWindow` and inspecting the document, then attaching `webContents.debugger` and sending `WebMCP.enable`.

| | Chromium | `document.modelContext` | CDP `WebMCP` domain |
| --- | --- | --- | --- |
| Electron 42 (what we ship) | 148 | absent under every flag tried | absent |
| Electron 44 | 152 | present under `--enable-blink-features=WebMCP` or `--enable-experimental-web-platform-features` | present, no flag needed |

Electron 43 is Chromium 150 and Chrome's origin trial opened in 149, so it is very likely fine, but it was not probed.

Two traps cost a wrong answer on the first pass, and both will cost the next person one too:

- **The API is `[SecureContext]`.** A probe against a `data:` URL reports the API absent even on a build that has it, because a `data:` URL is an opaque origin and is not potentially trustworthy. Probe over `http://localhost`, which is.
- **`WebMCP.invokeTool`'s `input` is an object, not a JSON string.** Passing a stringified payload fails with a bare `Invalid parameters` that names neither the parameter nor the reason.

### The round trip works

On Electron 44 with the blink feature enabled, driving a page that called `registerTool` in an inline script, through `webContents.debugger`, which is the same object [`dispatch-command.ts`](../../apps/studio/src/electron-main/browser-view/dispatch-command.ts) sends to:

```
WebMCP.enable
  -> toolsAdded { name: "add-todo", inputSchema: {...}, frameId }
WebMCP.invokeTool { frameId, toolName: "add-todo", input: { text: "buy milk" } }
  -> { invocationId }
  -> toolInvoked
  -> toolResponded { status: "Completed", output: "Added buy milk (list now has 1 item)" }
page DOM mutated as the tool's execute() specified
```

Nothing in the domain is missing for a CDP-driven agent, and nothing about our bridge stands in the way. There is no CDP domain allowlist in `dispatch-command.ts`, so `WebMCP.*` commands pass through untouched, and guest debugger events are already forwarded to the bridge by [`manager.ts`](../../apps/studio/src/electron-main/browser-view/manager.ts), so `toolsAdded` and `toolResponded` would arrive without new plumbing.

## What it took

One switch, `--enable-blink-features=WebMCP`, appended in [`setup-environment.ts`](../../apps/studio/src/electron-main/setup-environment.ts). Everything else on the list below had already gone away:

- **The Electron upgrade** landed as part of the dependency sweep. 44.4.5 is Chromium 152.
- **The CDP domain needs no switch**, as this finding's table said. Measured by elimination on 2026-10-15: with the blink switch alone, the page registers and `webmcp list` returns its schema; with `--enable-features=DevToolsWebMCPSupport` alone and no blink switch, `document.modelContext` is undefined and there is nothing to read. `WebMCPTesting` and `DevToolsWebMCPSupport`, the two feature names the agent-browser binary carries, are both unnecessary here.
- **Subcommands are upstream now.** 0.38.1 ships `webmcp list`, `invoke`, `result` and `cancel`, and announces a page's tools in its own browser responses on first discovery and whenever the catalog changes, capped at 16 tools and 4 KiB. Nothing was needed in our wrapper: the argv policy is a blocklist and `webmcp` is not on it.
- **Untrusted-output handling is upstream's too**, and stricter than ours: it marks summaries `untrusted: true` in JSON and wraps page metadata in nonce-bearing content boundaries in its text output, the same marker lines we stopped asking for in `82bd8bbea` because piping them into `jq` or `head` read them as data. They are back on this one path, and the `origin=` on the marker line reads `unknown`; the tool's real origin is a field inside the JSON.

Two behaviors worth knowing before building on it:

- **Discovery is asynchronous.** A tool registered by an inline script is not there the instant `open` returns; it arrives on the next browser response. An `invoke` issued immediately after `open` fails with `webmcp_tool_not_found`, and the same call a second later succeeds.
- **The announcement is unconditional.** It rides on the browser response whenever the catalog changes, so a chat that browses a tool-bearing site pays for it whether or not it was ever going to call a page tool.

### Driven end to end, 2026-10-15

In the app, dev build against a disposable workspace, through the agent's own shell:

- A local page over `http://127.0.0.1` that registers one tool inside `if (document.modelContext)`: announced on `open`, full schema from `webmcp list --json`, `webmcp invoke add-todo --params '{"text":"buy milk"}'` ran the page's own `execute()` and the DOM gained the item.
- `webmcp.com`, a third party: 9 tools announced with their origins, `search_directory` invoked with `{"query":"travel"}` and answered with 535 matching sites.

The adopter count has grown rather than stalled, which this finding named as the number to re-check: the directory listed 115 sites when this was written and 139 on its own page on 2026-10-15, and its search reports many more than either figure.

## The surface is real but small

Two public directories track adopters. [webmcpdirectory.com](https://webmcpdirectory.com/) listed 115 sites exposing 314 tools when this was written, across commerce, travel, finance, and developer tools, including recognizable consumer brands rather than only demos. [webmcp.cool](https://webmcp.cool/) tracks the same space.

That is small, but it is not zero, and it is the number to re-check before deciding this is worth building. The value of the feature scales with it directly and with nothing else.

## The polyfill shortcut, and why it is a bridge and not a destination

A site that ships WebMCP guards its registration on the API existing. Injecting a polyfill at document start, before any page script runs, therefore makes that guard pass and captures the site's own tools into a registry we own. This was probed on **Electron 42**, with a minimal polyfill delivered through `Page.addScriptToEvaluateOnNewDocument` against a page that registers only inside `if (document.modelContext)`: the site registered, `getTools()` returned its schema, `executeTool()` ran it, and the page mutated. So the capability is reachable today without upgrading.

It should still not be how we ship it:

- It means injecting script into arbitrary third-party pages, which is a security surface we do not otherwise have.
- Everything the browser enforces becomes ours to reimplement and to get subtly wrong: secure-context gating, `exposedTo` origin restrictions, the iframe `allow="tools"` permissions policy, abort signals, and the declarative `<form toolname>` schema synthesis, which is pure browser behavior with no JavaScript hook to imitate.
- A polyfilled `executeTool` is ordinary page JavaScript in the main world, so there is no browser-enforced boundary between the tool registry and a hostile page.

Keep it as the answer to "can we demo this before the upgrade lands", not as the plan.

## Before building this, check that these are still true

The spec is moving weekly and is in a Community Group, not on a standards track. It has already renamed `navigator.modelContext` to `document.modelContext`, and Chrome deprecated the old name in 150 while the origin trial still shipped it.

- The CDP domain still carries `invokeTool` and `cancelInvocation` with the same shapes.
- `--enable-blink-features=WebMCP` is still how the page API turns on, and the origin trial has not become the only path.
- The adopter count has grown rather than stalled.
- Chromium has not moved tool invocation behind a user-gesture or user-consent requirement, which would land badly on an agent that has no gesture to offer.

## Related

- [in-app-browser.md](../architecture/in-app-browser.md) for the CDP path from `agent-browser` to the guest.
- [agent-sandbox.md](../architecture/agent-sandbox.md) for the `agent-browser` argv policy any new subcommand has to fit.
