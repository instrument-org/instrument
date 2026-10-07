# Inference through the user's Claude and ChatGPT subscriptions

Status: **ChatGPT direct route landed (`ca68bb66d`, `8b3b27b53`, first shipped in v2.0.0-beta.37). Claude route spiked: works end to end on macOS, not yet shipped** (checked 2026-10-07). Policy snapshot verified 2026-10-07 against the primary sources linked below, and OpenAI's Sign in with ChatGPT docs on 2026-09-29. Those terms have changed several times this year, so re-check them before shipping.

## Goal

A user who already pays for Claude (Pro or Max) or ChatGPT (Plus or Pro) can run Instrument on that plan instead of our credits. We run the official `claude` or `codex` CLI on their machine, signed in with their own account. We stay the tool host: our prompt, our sandboxed tools, our skills and our transcript, with their subscription supplying the model.

This lowers the barrier to trying the product for people who already pay for a model.

## What the terms allow

The line both providers draw is about **who handles the credential** and **whether the official binary is modified**. It is not about who installed the binary.

### Anthropic

Sources: [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).

- **Allowed:** an end user signs in to the unmodified Claude Code binary with their own subscription, including when another product runs that binary.
- **Forbidden:** offering Claude.ai login in our app, or collecting, storing or intermediating their credentials or session tokens. Sign-in completes through Anthropic's own flow (`claude`, then `/login`).
- **Bundling:** preinstalling the binary is covered by the Commercial Terms, on condition that it is unmodified and no authentication method is removed or restricted. Detecting a copy the user installed avoids the question entirely.
- **Branding:** we can say Instrument "runs Claude Code" in plain text. We cannot use the name or logo in a way that suggests a partnership.
- **Usage:** plan limits "assume ordinary, individual usage". A June 2026 plan to move headless and Agent SDK usage onto a separate monthly credit was paused. Such usage currently draws from the normal plan limits.
- **Enforcement** can happen without notice. Anthropic has already cut off one third-party tool's OAuth access and ended subscription coverage for another in 2026.

### OpenAI

Sources: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Codex auth](https://learn.chatgpt.com/docs/auth), [Codex license](https://github.com/openai/codex/blob/main/LICENSE).

- The Codex CLI and `@openai/codex-sdk` are Apache-2.0, so bundling is allowed.
- The app-server is documented as the way to embed Codex in your own product, including ChatGPT sign-in, conversation history, approvals and streamed events. It is marked experimental and not supported for production workloads.
- OpenAI's welcome for third-party use of ChatGPT plans comes from public posts by the Codex team, not from the terms.

### Rules we follow

1. Spawn the official, unmodified binary and never patch or wrap its authentication.
2. The user signs in through the CLI's own flow. We never read, store or forward `~/.claude` or `~/.codex` credentials.
3. Use no provider branding that implies a partnership.
4. Treat the feature as removable. If a provider revokes it, that provider's entry fails with a clear message and everything else keeps working.

## ChatGPT: the direct route

OpenAI's [ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source) for open-source, locally run apps needs no CLI. The app signs the user in with OAuth (a public client registered on first sign-in as `dynamic_agent_client`, PKCE, a `127.0.0.1` loopback callback, and the `chatgpt.tokens.use.direct` scope), then sends the access token as the bearer on the public `POST /v1/responses`. Codex app-server is documented only as one consumer of that token. A paid or remotely hosted app goes through OpenAI's partner interest form instead.

That keeps our own loop, tools, prompt, and transcript, with no CLI between us and the model:

- **Sign-in and tokens** live in the main process ([`chatgpt-plan.ts`](../../../apps/studio/src/electron-main/lib/chatgpt-plan.ts)): a stable `urn:uuid:` host id, ID-token validation against OpenAI's JWKS, an encrypted store of registrations (one per ChatGPT user and workspace, each with the client id OpenAI issued it and its own tokens, as OpenAI's [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) guidance asks), a serialized refresh per registration ahead of the one-hour expiry, and revocation on sign-out. A person can sign in to several accounts; each is labeled by its email, numbered when one email has registered twice, since nothing OpenAI returns names the workspace.
- **The provider** is a synthesized `chatgpt` config per signed-in account, like our own, whose id is the registration's and whose key is its current access token ([`get-ai-provider-configs.ts`](../../../apps/studio/src/electron-main/lib/get-ai-provider-configs.ts)). A chat runs on the account its model names and never falls over to another: the [Sign in with ChatGPT Terms](https://openai.com/policies/sign-in-with-chatgpt-terms/) forbid rotating accounts to get past usage limits, so `selectProviderConfigs` never picks a second `chatgpt` config as a fallback. Models come from the account's `/v1/models` catalog, which is `{ models: [{ slug, display_name, visibility }] }` rather than the API's list.
- **The request rewrite** happens in the local gateway ([`chatgpt-plan-request.ts`](../../../packages/ai-gateway/src/lib/providers/chatgpt-plan-request.ts)): `store: false` and `stream: true` always, the refused fields (`max_output_tokens`, `user`, `temperature` and the rest) dropped, system items rewritten as developer items, and a request that asked for JSON collapsed from `response.completed`. The platform gateway is never involved.

Since landed on this route: Continue with ChatGPT on the login screen (`f6d266516`), a settings card (`settings/chatgpt-plan-card.tsx`), and a spent or declined plan reported as a usage-limit error rather than retried (`822768ad7`, `c38549d8f`). Not rechecked here: whether plain top-level function tools are accepted (the docs say to group them in namespaces or send them as `additional_tools`), and image generation and hosted web search needing another provider.

## Claude: the CLI as a model

Anthropic offers no OAuth or token-sharing program like OpenAI's (checked 2026-10-07; the feature request is open on `anthropics/claude-code` with no reply). The only allowed route is the user's own `claude` CLI, unmodified and signed in through its own flow, which is how Raycast 2.3 does it.

What we build keeps our loop, tools, prompt and transcript, as the ChatGPT route does. The CLI is driven as a model, never as an agent that owns the turn:

- **The model** ([`claude-plan/language-model.ts`](../../../packages/ai-gateway/src/lib/providers/claude-plan/language-model.ts)) is an AI SDK `LanguageModelV4` over `@anthropic-ai/claude-agent-sdk`. Each `doStream` is one step. The CLI runs with every built-in tool off (`tools: []`), our system prompt, no settings sources, claude.ai connectors off, `strictMcpConfig`, and `persistSession: false`, and our tools are served to it from an in-process MCP server.
- **A tool call** ends the step with `tool-calls`. Its MCP handler waits, keyed by the `claudecode/toolUseId` the CLI stamps on each call, until our loop's next request arrives carrying the result. Our `runToolCall` stays the only thing that runs a tool.
- **One process per session and shape** ([`claude-plan/session.ts`](../../../packages/ai-gateway/src/lib/providers/claude-plan/session.ts)), keyed by the `CLIENT_SESSION_ID_HEADER` our requests already carry plus a hash of the system prompt and tools. A request continues the process when its prompt is exactly what the process saw plus our tool results, or plus a new user turn. Anything else (an abort, an app restart, a model switch from another provider, a fork) starts a new process primed with a text replay of our transcript, which is lossy: reasoning is dropped and earlier files become names. A tool-less request (a title, a summary) or one that arrives while its session is mid-step runs on a process of its own that ends with it.
- **Detection and sign-in** live in main ([`claude-plan.ts`](../../../apps/studio/src/electron-main/lib/claude-plan.ts)): the CLI is looked for where people install it (Dock-launched apps lack the shell's `PATH`), version-gated to the SDK we build against, and asked `claude auth status`, which never shows a credential. Only `authMethod: "claude.ai"` counts as a plan. Sign in opens a terminal running `claude auth login`, re-checked when a window takes focus. The person can choose the executable and the config folder (`CLAUDE_CONFIG_DIR`), stored per computer.
- **Usage** comes from the SDK's experimental usage call, by window (5-hour, weekly, model-scoped), shown on the settings card. A refused request maps to `claude_plan_usage_limit_exceeded`, which `classify-provider-error` reads as `usage-limit`. A plan's limit, ChatGPT's or Claude's, offers Instrument as a button: Switch to Auto when signed in, Try Instrument when not. It is never a silent fallback, which the Sign in with ChatGPT Terms §2 rule out.
- **The binary is not shipped.** The SDK's per-platform CLI packages are in `ignoredOptionalDependencies`, and `pathToClaudeCodeExecutable` always names the user's own.

Checked on a Max plan in a clean room: a multi-step turn with our real tools, a follow-up on the same process, stop mid-stream then a new turn, a chat handing work to a task that ran on its own process, and usage matching what Raycast shows.

## Open questions

- Does replacing the whole system prompt and every built-in tool still count as "ordinary, individual usage"? The flags are documented, but the terms do not address it, and the SDK overview's "unless previously approved" line can be read against any product that offers this. Raycast ships the same setup unchallenged.
- The usage call is marked experimental and may change without notice.
- Windows and Linux: detection paths, opening a terminal for sign-in, and process-tree kills are written but unrun.
- Packaging: the SDK must be reachable from the packaged main bundle; unchecked.
- Monetization: subscription users pay us nothing for inference, so what they pay for has to be the product itself.
