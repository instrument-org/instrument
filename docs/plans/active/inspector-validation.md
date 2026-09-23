# Plan: validate the inspector before drawing it again

Status: proposed. Drafts measured (below); Linear and Notion not yet. Nothing here is committed until the questions below have answers; the wireframe that prompted it is a scratch artifact and the direction is unproven.

## What the inspector is

An app with no site (Drafts on the Mac is the example; any local server is the case) has nothing to promote to the Apps place, and a page drawn per app is out: nobody wants to build or maintain a generated interface for every service. The inspector is the alternative: one generic browser of the app's own data. Three columns in one card: what the app can list at the left, the records of the chosen kind in the middle, the chosen record's fields at the right as labels and values in the app's own words. Every click is a read. Nothing on the card writes. Links inside a record open as pages; ids that name another kind drill into it. If it works for a local app it should work the same way for Linear and Notion, which makes it a jumping-off point in any app, not a consolation for the siteless ones.

It is only worth building if the data on disk and behind the connection already carries enough shape to draw it with no per-app code and no model in the loop when the page opens. That is the thing to find out.

## What is already true

- An app is a folder holding `app.json` (`api` with a base URL and an auth scheme, `mcp` with a server URL, or `mcp-local` with a package, a runtime and arguments) plus a `guide.md`; the connection record lives outside the folder.
- For MCP apps the client lists tools and calls them (`packages/workspace/src/lib/apps/mcp/client.ts`). The listing keeps name, description and input schema only; `annotations` (`readOnlyHint`, `destructiveHint`, `openWorldHint`) and `outputSchema` are dropped, and resources are not listed at all.
- A tool result arrives as MCP content blocks, most often one text block whose text is whatever the server chose: JSON, Markdown, or prose. Nothing in the client parses it.
- A local server is started and stopped around each operation.
- The catalog carries no local servers; the manifest help names a Drafts package as its `mcp-local` example, and whether that package exists on the registry has not been checked.
- The connection paths that exist are OAuth on hosted servers (Linear, Notion), a key on `api` apps, and none or an environment variable on local ones. Gmail and Slack are not connectable without a client we hold, so they are out of scope here regardless.

## The questions, in the order they can kill the idea

1. **Can a read be told from a write without a person or a model deciding?** The spec's `readOnlyHint` is the honest signal, and the client drops it. Extend the listing to keep annotations and output schemas, then count, per server, how many tools carry hints at all. If Linear's and Notion's servers do not annotate, the fallback is a name rule (`list_`, `get_`, `search_`, `find_`, `read_`, `fetch_`) plus refusing anything else; that is weaker and needs a human look at each server's list once. Fail if neither the hints nor the names classify most of a server's tools.
2. **Does a list tool answer with no arguments?** For each read tool, call it with `{}` and record: succeeded, needed an argument (which), latency, response size. The inspector's left column is only the tools that answer bare. Fail if fewer than one per app does.
3. **Is the answer a list of things?** Parse the text block: JSON, or not. If JSON, find the first array of objects and the field that reads as a title (`title`, `name`, `subject`, `identifier`); if Markdown or prose, the record column is a Markdown viewer per item, which is still generic but a worse row. Record the shape per tool. Fail if the three apps disagree so much that the renderer needs a case per app.
4. **Can a record drill into its detail?** A field named like an id, and a read tool whose input schema requires one string named like it, is the link. Check how often that pairing exists (issue to `get_issue`, page to `fetch`). Without it the right column is the list item's own fields and no more, which may be enough.
5. **What is a link?** A string field that parses as an http(s) URL opens as a page in the place's tabs; an id that names another kind drills. Count how many fields per record are one or the other. This is what makes the inspector a jumping-off point rather than a JSON viewer.
6. **Can Drafts be read at all?** Three paths, in order of how little the person has to do: an MCP package on the registry that reads the app's store; the app's own scripting dictionary through `osascript` on the host, which costs one macOS automation prompt; the app's local database, whose format is undocumented and can change under us. Record which one answers, what a draft record holds, and whether tags and workspaces are listable. Fail if only the database path works.
7. **How slow is a click?** A local server that starts per operation turns every row press into a spawn. Measure a cold start for a node stdio server; past about a second the inspector needs the pooled process with an idle timeout that the apps plan already lists as later work. Hosted servers pay a network round trip per click instead; measure that too, and decide the cache (key on tool plus arguments, a short life) before dogfooding.
8. **What does the connection let a viewer do?** Reads run under the same connection record as the agent's calls, so an app the person connected for the agent is also readable by hand. Confirm a read-only tool call cannot be turned into a write by argument (a `search` that accepts an `update` flag, say) by reading each allowed tool's input schema for verbs.

## Drafts, measured

`@agiletortoise/drafts-mcp-server` 1.0.12 exists on npm and reads Drafts through AppleScript, so question 6 passes by the scripting path. Probed from a scratch script with the SDK client on macOS against a library of 37 drafts:

- **Reads vs writes (1):** all 20 tools carry annotations. 13 say `readOnlyHint: true`; every write says false, and `update`, `trash` and `run_action` also say `destructiveHint: true`. One trap: `drafts_open` is marked read-only but brings the draft up in the Drafts window, so the hint means "changes no data", not "has no effect". The inspector's allowed set is read-only hints minus anything named `open`, or it needs a human look per server after all.
- **Bare answers (2):** `list_workspaces`, `list_tags`, `list_actions`, `get_drafts`, `get_current` and `get_current_workspace` all answer `{}`.
- **Shape (3):** every answer is one text block holding JSON; no `outputSchema`, no `structuredContent`. Lists are arrays of objects with `name` (workspaces, tags, actions) or `id` plus `title` (drafts). Summaries omit `content`; the detail carries it.
- **Drill (4):** records call their key `id`, and `get_draft` requires `uuid`. The name rule in question 4 misses it; matching a lone required string parameter whose description says "UUID" against an id field of UUID shape finds it. Workspace and tag names drill the same way into `get_workspace_drafts` and `get_tag`.
- **Links (5):** `permalink` is a `drafts://` URL, which opens the draft in Drafts rather than as a page. Other apps will have their own schemes, so a link is "a URL the OS can open", not only http(s).
- **Facets:** `get_drafts` has an optional `folder` enum (`inbox`, `archive`, `trash`) and optional `tag` and `flagged` filters. Optional enum parameters on a bare list tool are a generic way to draw filters with no per-app code.
- **Speed (7):** the stdio server connects in about 100 ms. The cost is AppleScript: the first call about 1.5 s, `get_drafts` about 5.7 s for 37 drafts, `get_workspace_drafts` about 2.4 s, a single draft or tag about 0.4 s. Per-operation spawning is not the problem; the list reads need a cache, and a large library will need one more.

## How to run it

A script, not a screen. It opens each connected server (Linear, Notion, and whichever Drafts path answers), captures the annotated tool list, runs the bare calls, and writes one table per app: tool, classified as read or not and by what evidence, answered bare or not, shape, title field, id field, link fields, latency, size. Nothing in the product changes for this except keeping annotations and output schemas in the listing, which is a small, safe addition worth making anyway.

Only if two of the three apps pass questions 1 through 5, and Drafts answers question 6 by a path other than its database, build a throwaway renderer over the recorded answers (no product code, no design per app) and dogfood it for a week beside the recently visited pages of the same apps. The comparison to beat is history: if starting from the pages you were on is a better jumping-off point than the inspector every time, the inspector is not worth its maintenance, and siteless apps stay reachable only through the conversation.

## Exit criteria

- Two of three apps: at least one read tool answers bare, its answer parses to a list of objects with a title field, and a detail read exists for it.
- Drafts: readable by a package or by scripting, with tags or workspaces listable.
- A click costs under a second warm, with the pooling or cache that gets it there named.
- No allowed tool can write by argument.

Anything short of that and the plan moves to `completed/` with the answer recorded as "not viable" and why, so the question is not reopened by the next person who sees a JSON viewer and wonders.

## Not in this plan

- Any per-app mapping, lists file, or generated interface the agent has to maintain.
- Any write verb on the card. Changes go through the conversation.
- The pooled local server and the response cache as product work; this plan only measures whether they are needed.
- Gmail, Slack, and any service that needs a client we do not hold.
