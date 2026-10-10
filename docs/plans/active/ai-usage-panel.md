# Plan: an AI usage panel in Settings

Status: spiked. Capture, store, RPC and the Settings section are built and checked against real requests; the open items are listed under "Known gaps".

## Problem

The app makes model requests the person never asked for by name: naming a chat, picking its emoji, suggesting a topic, searching chats and settings by meaning, finding an app, web search, image generation. On top of the chat replies themselves, those go to whichever connection the person set up, and the model can change between requests. Nothing in the product shows that traffic. For an open-source product this is the place to be fully transparent: every request the app made on the person's behalf, which connection and model answered it, why it was made, how many tokens it used, and how long it took.

Chat replies already store their usage (`metadata.usage` on the assistant message in each `chat.db`), but nothing else does, and none of it is gathered in one place.

## Decisions already made

- **Metadata only.** No request or response bodies: what was said already lives in each chat's own store, and leaving it out keeps the record safe to export or attach to a bug report.
- **No money figures** in the first version. Rows carry tokens and duration; cost can join later as an optional field.
- **No backfill.** The record starts empty on upgrade. Backfilling only chat replies from `chat.db` would make the purpose breakdown misrepresent the past.
- **The panel is a request log**: one row per request (a step of the agent loop, not a whole reply), newest first, with the date and time leading each row. Not grouped by chat. The Settings tab is named "AI usage".
- **Filtering is generic.** One Filter control adds a removable chip per condition (type, purpose, origin, connection, model, result, date), the chips combine, every column header sorts, and a totals line follows the filters.
- **Type uses model-kind terms**: Language model, Decision model, Web search, Image model, so a decision model's choice never reads like a language model's reply.
- **Pressing a row opens a detail page** inside Settings with a back link, the way Skills steps into a skill: exact model IDs asked for and answered by, connection, request and response IDs, timestamps, the token breakdown, and Open chat when the chat still exists. A request from a deleted chat keeps its row and loses only the link.
- **Export saves a CSV copy** through the save panel, with the same columns as the log. The stored file is never revealed in the Finder, so nobody deletes the only copy by accident.
- **A call that retries is one row.** A call made with `maxRetries` (titles, the provider-model web search) retries inside one SDK call, so its attempts share a row whose duration is the last attempt's. Counting each attempt would need capture in the provider proxy, which this design keeps out of.
- **The list is virtualized** and loads pages as it scrolls, so it reaches all of history without a pager.

## Shape

### The row

| Field | Notes |
|---|---|
| id, started at, duration | |
| status | finished, failed (with the HTTP status or error kind), stopped |
| finish reason | as the model reported it: ended its turn, called a tool, hit the length limit |
| type | language model, decision model, web search, image model |
| purpose | chat (a step in the chat's own session), task (a step in one of its tasks, a session whose parent is the chat's), chat title, title check, web search, image, emoji suggestion, topic suggestion, topic backfill, chat search, settings search, app search, other |
| chat id, session id | the chat and the session in it that asked; absent for requests that belong to no chat; origin is shown from these, or from the surface (Settings, Apps, Chats) when there is none |
| connection | its id, type and display name; never its key |
| model requested | the model ID the request named |
| model served | only when the response named one; absent means no evidence |
| response id | the provider's own ID for the response, when it sent one |
| tokens | input, cache read, cache write, output, reasoning; each absent when the response did not report it. A task starts from the chat's whole conversation, so its first request is mostly cache read |

### Capture

Four kinds of call, each recorded where it already has the facts:

- **Language models, through AI SDK telemetry** (`lib/ai-usage/record.ts`). Each call site passes `telemetry: aiUsageTelemetry({ purpose, chatId, sessionId, connection })`, a per-call integration that carries what the call site knows; the SDK lets a per-call integration replace the global ones, so nothing is counted twice. One more integration, registered globally with `registerTelemetry` when the workspace starts, records every call that passes none as "Other", so a forgotten tag shows up as a gap rather than a missing request. A row is written per model call: `onLanguageModelCallStart` stamps the start, `onStepEnd` gives usage, the served model, the response id and the finish reason, and `onAbort` and `onError` give stopped and failed requests. The integration reads none of the prompt or output. This covers chat and task steps, titles and the provider-model web search on every connection, the Claude account included, since `createClaudeAccountLanguageModel` is an AI SDK language model like the rest.
- **Decision requests** record in `askDecisionModel` (`workspace/src/lib/decision-model.ts`), once per provider attempt. Every caller names its purpose: `decision.ask` takes a `usage` field, which Studio's `useDecision` fills from its own `usage` argument.
- **Image generation** records once per `generateImageStream`, whichever path made the image, since neither `generateImage` nor `streamOpenRouterImage` emits telemetry. The language-model path turns the SDK's own recording off so it is not counted twice.
- **Instrument web search** records in `requestPlatformSearch` (`lib/web-search.ts`), since the request itself is a `fetch` from the Electron main process that never reaches the gateway. The keyless fallback is not a model request and is not recorded.

The gateway's provider proxy is untouched: no body wrapping, no stream parsing, and a client's cancel still reaches the provider exactly as it does today.

### Storage

One SQLite table at `<workspace>/.instrument/ai-usage.db`, opened with `node:sqlite` in WAL mode so two Studio instances on one workspace can both write. It belongs to the workspace, so it lives in the workspace's own `.instrument` folder beside the browser's `history.db`, moves with the workspace, and goes when the workspace does. The app's data folder is for what belongs to the machine or can be rebuilt, such as the search index; this record is the only copy of what it holds.

Indexes on `started_at` and on each filterable column paired with `started_at` keep the totals line a single indexed aggregate. At a heavy thousand requests a day that is under 400,000 rows a year, a few hundred bytes each, so there is no rotation.

### Layers

| Package | Existing code touched | New code |
|---|---|---|
| `workspace` | `logic/server/index.ts` registers the telemetry integration and opens the store. Call sites pass a purpose: `logic/llm-request.ts`, `lib/generate-title-from-user-message.ts`, `lib/web-search.ts`, `lib/generate-images.ts`, `lib/decision-model.ts` and the decision RPC route | The store (schema, insert, filtered page, totals, CSV), the telemetry integration, and an RPC route over the store |
| `ai-gateway` | `lib/providers/claude-account/language-model.ts` passes `thinking_tokens` through as reasoning | |
| `studio` | `atoms/settings-modal.ts` gains `"AI usage"` in `SettingsTab`; the modal's nav and the settings search index gain the entry; decision callers pass their purpose | The section: virtualized table, filter chips, detail page |

Untouched: the provider proxy, `chat.db` and its schema, how messages are saved, the agent machines, model list fetches (not model requests).

## What each connection can report

- **Keys, OpenRouter, the ChatGPT account and Instrument's language models**: everything in the row, as far as the provider reports it. OpenAI-compatible providers send streamed usage only when the request asks for it, so those rows show tokens as not reported until that provider's settings ask.
- **The Claude account**: per step, input, cache read, cache write and output tokens and the model that answered. Claude Code makes some calls of its own inside a step, the model call behind its built-in WebSearch among them, and reports none of them separately; the detail page says so. Its end-of-turn totals are cumulative across a whole turn and are not used.
- **Decision models**: the model that answered and input tokens; the API reports no output tokens.
- **Web search and image models**: duration, result and model; tokens only when the response carries them.

## Risks to existing behavior

1. **The telemetry integration must never throw into a request or delay it.** Each callback catches its own errors, and the insert runs after the callback returns.
2. **Prompts must not reach the store.** The integration reads only usage, model, ids and timing, and a test asserts that no stored column holds message text.
3. **Write cost.** One small insert per request on the workspace server's thread. Negligible against a model request, but the store opens lazily and a locked or slow file drops the row rather than blocking.

## Known gaps

- **Escape in the filter menu closes Settings** rather than the menu.
- **The Claude account's reasoning tokens** are present in its stream (`output_tokens_details.thinking_tokens`) but `language-model.ts` passes reasoning as undefined, so its rows show none.
- **Export names chats by id**, since the CSV is written without the chat titles the page looks up.
- **Paging is by offset.** Fine at the sizes above; keyset paging is the change if a deep scroll ever measures slow.

## Out of scope

- Request and response bodies.
- Backfill from `chat.db`.
- Money figures.
- Retention and pruning.
- A per-chat grouping view; the origin filter covers "what did this chat use".

## Verification

- A unit test per capture kind against a fake model or fetch: a finished, a stopped and a failed request each produce one row with the right purpose, and an untagged call lands as Other.
- The prompt-leak test from risk 2.
- In the running app, one request of each purpose against Instrument, an OpenRouter key, a direct Anthropic or OpenAI key, the ChatGPT account and the Claude account, then read the panel: each row present, correctly typed and tagged, with the served model where a router chose one.
