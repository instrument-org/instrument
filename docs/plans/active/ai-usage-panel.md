# Plan: an AI usage panel in Settings

Status: planned, not started.

## Problem

The app makes model requests the person never asked for by name: naming a chat, renaming it, picking its emoji, sorting it into a topic, summarizing on wake, web search, image generation. On top of the chat replies themselves, those go to whichever provider the person configured, and the provider can change between requests. Nothing in the product shows that traffic. For an open-source product this is the place to be fully transparent: every request the app made on the person's behalf, which provider and model answered it, why it was made, and how many tokens it used.

Chat replies already store their usage (`metadata.usage` on the assistant message in each `task.db`), but nothing else does, and none of it is gathered in one place.

## Decisions already made

- **Capture in the gateway's provider proxy, not in the AI SDK.** Every in-process model call reaches `packages/ai-gateway/src/routes/provider.ts` through `internalURL()`: the AI SDK models, the decision model's `/systemone` request (a plain `fetch`), and image generation (`stream-image.ts`, also a plain `fetch`). The proxy is the one place where "every request" is true by construction, including callers added later. An AI SDK middleware would miss the two plain `fetch` callers.
- **The purpose arrives as a request header** (with the chat or task id), set at each call site and removed by the proxy before forwarding, the way `x-client-session-id` is already held aside. A request with no purpose header is still recorded, labeled "Other", so a forgotten tag shows up as a gap rather than a missing request.
- **Metadata only.** No request or response bodies: what was said already lives in each chat's and task's own store, and leaving it out keeps the record safe to export or attach to a bug report.
- **Cost is optional.** Our own API removes cost from its responses on purpose, so first-party rows show tokens only. Cost appears only when a provider reports it in its response (an OpenRouter key does). No estimate from catalog list prices: the catalog only prices OpenRouter-shaped models, which already report the real charge, and an estimate on first-party rows would surface the number our API withholds. Unknown cost is shown as unknown, never as $0.
- **No backfill.** The record starts empty on upgrade. Backfilling only chat replies from `task.db` would make the purpose breakdown misrepresent the past.
- **The panel is a request log**: raw rows, newest first, tagged by purpose, filterable by provider, model, purpose and chat, with a totals line that follows the filters, an expandable detail per row, and a JSON lines export. Not grouped by chat. The Settings tab is named "AI usage".

## Shape

### The row

One row per request:

| Field | Notes |
|---|---|
| id, started at, duration | |
| status | ok, failed (with the HTTP status), canceled |
| purpose | chat reply, task work, name a chat, rename a chat, pick an emoji, sort into a topic, summarize on wake, web search, generate image, other |
| chat id, task id | absent for app housekeeping that belongs to no chat |
| provider config | its id, type and display name; never its key |
| endpoint | `/chat/completions`, `/responses`, `/messages`, `/systemone`, `/images`, and so on |
| model requested | from the request body |
| model served | only when it differs, compared with `namesSameModel` (see [ai-gateway.md](../../architecture/ai-gateway.md#requested-and-served-models)); absent means no evidence, not the same model |
| tokens | input, output, cached, reasoning; each absent when the response did not report it |
| cost | only when the provider reported it |

### Storage

One SQLite file per workspace, opened with `node:sqlite`, in WAL mode so two Studio instances on one workspace can both write. Not inside the workspace folder: workspaces can live in synced folders, where a SQLite file and its log invite conflict copies (the reasoning in [chat-list-index.md](../completed/chat-list-index.md)). It sits in the app's data folder beside the workspace index, keyed the same way, but as its own file: the index is derived and thrown away on any version change, and this record is the only copy of what it holds.

### Layers

| Package | Existing code touched | New code |
|---|---|---|
| `ai-gateway` | `routes/provider.ts`: remove the purpose header, wrap the response body before returning it. `types.ts`: one more Hono context variable | A recorder: a pass-through transform over the response body that reads usage as it flows, one reader per response shape, handing the finished row to a callback supplied through context (the way `captureException` is) |
| call sites | Add the purpose header: `logic/llm-request.ts`, `lib/generate-title-from-user-message.ts`, `ai-gateway/src/lib/decision-model.ts` and its callers (emoji, topic, retitle), `lib/chat/wake.ts`, `lib/web-search.ts`, `lib/generate-images.ts` / `stream-image.ts`. AI SDK calls take it as `headers`; the plain `fetch` callers set it directly | |
| `workspace` | `logic/server/index.ts` supplies the callback | The store (schema, insert, filtered list, totals, export) and an RPC route over it |
| `studio` | `atoms/settings-modal.ts` gains `"AI usage"` in `SettingsTab`; the modal's nav gains the entry | The section component |

Untouched: `task.db` and its schema, how messages are saved, the agent machines, model list fetches (they do not go through the proxy).

### Usage readers

Each provider type answers in one of a few shapes, and the recorder needs one reader per shape, each for both a streamed (SSE) and a whole JSON response:

- **Chat Completions** (OpenRouter's chat path and the OpenAI-compatible providers): `usage` on the last chunk, sent in a stream only when the request asked for it (`stream_options.include_usage`).
- **Responses** (OpenAI, the first-party and OpenRouter paths for OpenAI models, the ChatGPT account): `response.usage` on `response.completed`.
- **Anthropic Messages**: input on `message_start`, output on `message_delta`.
- **Gemini**: `usageMetadata` on the chunks.
- **Decision model** (`/systemone`) and **images**: read their bodies to see what they carry; tokens may simply be absent.

A response a reader does not understand still produces a row, with its tokens absent.

## Risks to existing behavior

1. **Canceling a reply must still cancel the provider's request.** Today a client cancel propagates back through the proxied response stream and aborts the upstream fetch. `body.tee()` would break that: canceling one branch of a tee does not cancel its source, so the recorder's branch would keep reading and the provider would keep generating, and billing, after the person pressed stop. The recorder therefore inspects chunks in a pass-through transform rather than a tee, and a test cancels mid-stream and asserts the upstream request was aborted. A canceled request is recorded as canceled with its usage absent, since a stopped stream never sends its usage chunk but the provider may still bill it.
2. **The purpose header must not reach a provider.** Removing it sits beside the existing `x-client-session-id` handling, with a test that a third-party request never carries it.
3. **Recording is best effort.** No reader error or database failure may throw into the response or delay it. Parsing keeps a small line buffer across chunks and does no work on chunks that cannot contain usage; the row is written once, after the stream ends.
4. **Streams that omit usage.** OpenAI-compatible providers report stream usage only when asked. Whether the proxy or the SDK configuration starts asking is decided per provider during the build, since it changes what we send; until then those rows show tokens as not reported.
5. **The ChatGPT account path rewrites the stream** (`collapseResponsesStream` for a request that did not ask to stream), so the recorder wraps the response after that rewrite, not before.
6. **Write cost.** One small insert per request after its stream ends, on the workspace server's thread. Negligible against a model request, but the store must open lazily and never block a request on a slow or locked file.

## Out of scope

- Request and response bodies.
- Backfill from `task.db`.
- Cost estimates from list prices.
- Retention and pruning: a row is a few hundred bytes, so heavy use stays small for years.
- A per-chat grouping view; the chat filter on the log covers "what did this chat use".

## Verification

- Unit tests per usage reader against recorded streams of each shape, including a stream cut off mid-way.
- The cancel test from risk 1 and the header test from risk 2.
- In the running app, one request of each purpose against the first-party provider, an OpenRouter key, a direct Anthropic or OpenAI key, and the ChatGPT account, then read the panel: each row present, correctly tagged, with the served model where a router chose one.
