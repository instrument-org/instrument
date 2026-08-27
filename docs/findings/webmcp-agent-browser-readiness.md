# WebMCP: what it would take for the agent's browser to call a site's own tools

**Status:** open, researched and probed, nothing implemented. Blocked on an Electron major upgrade. Last checked 2026-08-27.

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

## What is actually missing

The platform is the blocker; our own wiring is nearly there.

- **The Electron upgrade.** 42 to 44 is two majors and is the entire cost of this feature. Nothing else on the list is more than a day.
- **A `--enable-blink-features=WebMCP` switch.** The CDP domain ships unflagged on 152, but a site that feature-detects will not register anything unless the page-facing API exists, so the flag is load-bearing even though we only consume over CDP. Chrome gates the page API behind an origin trial; an origin trial token is signed per origin and will not validate in Electron, so the command-line switch is how it gets turned on for every site rather than something we can rely on sites to carry.
- **Subcommands.** `agent-browser` has no notion of tools. Upstream v0.33.2 has zero WebMCP references, so `tools list` and `tools call` would be ours to add in [`agent-browser.ts`](../../packages/workspace/src/lib/shell-commands/agent-browser.ts) alongside the existing rewrites, plus the help text and the skill.
- **Untrusted-output handling.** The protocol itself annotates `toolResponded.output` as untrusted and a prompt-injection risk. Tool output needs the same nonce-delimited wrapping page content already gets, and for the same reason.

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
