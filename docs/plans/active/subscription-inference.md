# Inference through the user's Claude and ChatGPT subscriptions

Status: **ChatGPT direct route landed (`ca68bb66d`, `8b3b27b53`, first shipped in v2.0.0-beta.37). Claude route spiked: works end to end on macOS, not yet shipped** (checked 2026-10-07). Policy snapshot verified 2026-10-07 against the primary sources linked below, and OpenAI's Sign in with ChatGPT docs on 2026-09-29. Those terms have changed several times this year, so re-check them before shipping.

## Goal

A user who already pays for Claude (Pro or Max) or ChatGPT (Plus or Pro) can run Instrument on that plan instead of our credits. We run the official `claude` or `codex` CLI on their machine, signed in with their own account. We stay the tool host: our prompt, our sandboxed tools, our skills and our transcript, with their subscription supplying the model.

This lowers the barrier to trying the product for people who already pay for a model.

## What the terms allow

The line both providers draw is about **who handles the credential** and **whether the official binary is modified**. It is not about who installed the binary.

### Anthropic

Sources: [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [Agent SDK with your Claude account](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-account).

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
- OpenAI's welcome for third-party use of ChatGPT accounts comes from public posts by the Codex team, not from the terms.

### Rules we follow

1. Spawn the official, unmodified binary and never patch or wrap its authentication.
2. The user signs in through the CLI's own flow. We never read, store or forward `~/.claude` or `~/.codex` credentials.
3. Use no provider branding that implies a partnership.
4. Treat the feature as removable. If a provider revokes it, that provider's entry fails with a clear message and everything else keeps working.

## ChatGPT: the direct route

OpenAI's [ChatGPT account usage](https://developers.openai.com/siwc/token-sharing-open-source) for open-source, locally run apps needs no CLI. The app signs the user in with OAuth (a public client registered on first sign-in as `dynamic_agent_client`, PKCE, a `127.0.0.1` loopback callback, and the `chatgpt.tokens.use.direct` scope), then sends the access token as the bearer on the public `POST /v1/responses`. Codex app-server is documented only as one consumer of that token. A paid or remotely hosted app goes through OpenAI's partner interest form instead.

That keeps our own loop, tools, prompt, and transcript, with no CLI between us and the model:

- **Sign-in and tokens** live in the main process ([`chatgpt-account.ts`](../../../apps/studio/src/electron-main/lib/chatgpt-account.ts)): a stable `urn:uuid:` host id, ID-token validation against OpenAI's JWKS, an encrypted store of registrations (one per ChatGPT user and workspace, each with the client id OpenAI issued it and its own tokens, as OpenAI's [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) guidance asks), a serialized refresh per registration ahead of the one-hour expiry, and revocation on sign-out. A person can sign in to several accounts; each is labeled by its email, numbered when one email has registered twice, since nothing OpenAI returns names the workspace.
- **The provider** is a synthesized `chatgpt-account` config per signed-in account, like our own, whose id is the registration's and whose key is its current access token ([`get-ai-provider-configs.ts`](../../../apps/studio/src/electron-main/lib/get-ai-provider-configs.ts)). A chat runs on the account its model names and never falls over to another: the [Sign in with ChatGPT Terms](https://openai.com/policies/sign-in-with-chatgpt-terms/) forbid rotating accounts to get past usage limits, so `selectProviderConfigs` never picks a second `chatgpt-account` config as a fallback. Models come from the account's `/v1/models` catalog, which is `{ models: [{ slug, display_name, visibility }] }` rather than the API's list.
- **The request rewrite** happens in the local gateway ([`chatgpt-account-request.ts`](../../../packages/ai-gateway/src/lib/providers/chatgpt-account-request.ts)): `store: false` and `stream: true` always, the refused fields (`max_output_tokens`, `user`, `temperature` and the rest) dropped, system items rewritten as developer items, and a request that asked for JSON collapsed from `response.completed`. The platform gateway is never involved.

Since landed on this route: Continue with ChatGPT on the login screen (`f6d266516`), a settings card (`settings/chatgpt-account-card.tsx`), and a spent or declined plan reported as a usage-limit error rather than retried (`822768ad7`, `c38549d8f`). Not rechecked here: whether plain top-level function tools are accepted (the docs say to group them in namespaces or send them as `additional_tools`), and image generation and hosted web search needing another provider.

## Claude: the CLI as a model

Anthropic offers no OAuth or token-sharing program like OpenAI's (checked 2026-10-07; the feature request is open on `anthropics/claude-code` with no reply). The only allowed route is the user's own `claude` CLI, unmodified and signed in through its own flow, which is how Raycast 2.3 does it.

What we build keeps our loop, tools, prompt and transcript, as the ChatGPT route does. The CLI is driven as a model, never as an agent that owns the turn:

- **The model** ([`claude-account/language-model.ts`](../../../packages/ai-gateway/src/lib/providers/claude-account/language-model.ts)) is an AI SDK `LanguageModelV4` over `@anthropic-ai/claude-agent-sdk`. Each `doStream` is one step. The CLI runs with every built-in tool off (`tools: []`), our system prompt, no settings sources, claude.ai connectors off, `strictMcpConfig`, and `persistSession: false`, and our tools are served to it from an in-process MCP server.
- **A tool call** ends the step with `tool-calls`. Its MCP handler waits, keyed by the `claudecode/toolUseId` the CLI stamps on each call, until our loop's next request arrives carrying the result. Our `runToolCall` stays the only thing that runs a tool.
- **One process per session and shape** ([`claude-account/session.ts`](../../../packages/ai-gateway/src/lib/providers/claude-account/session.ts)), keyed by the `CLIENT_SESSION_ID_HEADER` our requests already carry plus a hash of the system prompt and tools. A request continues the process when every message it carries that the process has not seen comes after the ones it has (compared by content fingerprint), so the new ones are our tool results or a new user turn. Notices the workspace says for one request only (a context rollover, a budget warning) are marked transient: sent with the turn but never counted as seen, since the next request drops or rewords them. Anything else (an abort, an app restart, a model switch from another provider, a fork) starts a new process primed with a text replay of our transcript, which is lossy: reasoning is dropped and earlier files become names. A tool-less request (a title, a summary) or one that arrives while its session is mid-step runs on a process of its own that ends with it.
- **Our own Claude Code** ([`claude-code-download.ts`](../../../apps/studio/src/electron-main/lib/claude-code-download.ts)): the Agent SDK ships a manifest of the Claude Code release it was built against, with each platform's binary and sha256. Studio downloads that exact binary from the npm registry, checks npm's integrity hash and Anthropic's checksum, and installs it unmodified under the app's data folder, so the CLI always matches the SDK. Nothing looks for a copy on the system, and there is nothing to choose.
- **Sign-in** ([`claude-account.ts`](../../../apps/studio/src/electron-main/lib/claude-account.ts)) keeps our copy's Claude sign-in in its own config folder (`<userData>/claude-account`, as `CLAUDE_CONFIG_DIR`), apart from `~/.claude`, so signing in here never switches the person's own Claude Code account. Continue with Claude asks Claude Code, over the SDK's control channel, to start its own claude.ai sign-in (the requests its IDE integrations use) and opens the page it returns; that page's redirect goes back to a port Claude Code listens on, so the code and tokens never pass through Instrument. The app comes to the front when it lands. When the browser cannot reach that port (signing in on another device, or a browser that blocks the redirect), the card offers Claude's manual link, whose page shows a code; the person pastes it into Instrument, which hands it to Claude Code over the same control channel (`claudeOAuthCallback`) without storing it. That code is a one-time authorization code, not a credential, but it does pass through our process, which is the one place this flow touches anything Anthropic's sign-in issues. A terminal running `claude auth login` (Terminal on macOS, `cmd start` on Windows, the first of `x-terminal-emulator`, `gnome-terminal`, `konsole` or `xterm` on Linux) is the last fallback, and the card prints the command when no terminal opens. `claude auth status` (and its text form, which alone says a sign-in has expired) is the only status read; only `authMethod: "claude.ai"` counts.
- **Usage** comes from the SDK's experimental usage call, by window (5-hour, weekly, model-scoped), behind a Usage button on the settings card, since reading it starts Claude Code. A refused request maps to `claude_account_usage_limit_exceeded`, which `classify-provider-error` reads as `usage-limit`. A plan's limit, ChatGPT's or Claude's, offers Instrument as a button: Switch to Auto when signed in, Try Instrument when not. It is never a silent fallback, which the Sign in with ChatGPT Terms §2 rule out.
- **Web search** on a Claude account chat runs Claude Code's own WebSearch (on Anthropic's side, on the subscription) in a one-off process with only that tool on; its results come back as sources.
- **The binary is not shipped in the app.** The SDK's per-platform CLI packages are in `ignoredOptionalDependencies`, and `pathToClaudeCodeExecutable` always names the downloaded copy.

Checked on a Max plan in a clean room: a multi-step turn with our real tools, a follow-up on the same process, stop mid-stream then a new turn, a chat handing work to a task that ran on its own process, and usage matching what Raycast shows.

## Open questions

- Does replacing the whole system prompt and every built-in tool still count as "ordinary, individual usage"? The flags are documented, but the terms do not address it, and the SDK overview's "unless previously approved" line can be read against any product that offers this. Raycast ships the same setup unchallenged.
- The usage call is marked experimental and may change without notice.
- Windows: download, install, browser sign-in and a chat handing work to a task are checked; process-tree kills on stop are not. Linux: download and verify are checked on aarch64; the app flow is not.
- Startup: each task starts a fresh Claude Code process, about 2s on its first step. The SDK's warm-spare option should cover it; not tried.
- Several Claude accounts: possible in principle, one config folder each, but rotating accounts past a usage limit is what the ChatGPT terms forbid and Anthropic's may too. Not offered.
- Packaging: the SDK must be reachable from the packaged main bundle; unchecked.
- Monetization: subscription users pay us nothing for inference, so what they pay for has to be the product itself.
