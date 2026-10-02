# Inference through the user's Claude and ChatGPT subscriptions

Status: **ChatGPT direct route landed (`ca68bb66d`, `8b3b27b53`, first shipped in v2.0.0-beta.37); the Codex and Claude Code harnesses (everything under "Approach" and "Phases") not started** (checked 2026-10-02). Policy snapshot verified 2026-09-26 against the primary sources linked below, and OpenAI's Sign in with ChatGPT docs on 2026-09-29. Those terms have changed several times this year, so re-check them before building anything.

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

That keeps our own loop, tools, prompt, and transcript, so none of the harness work below applies to ChatGPT:

- **Sign-in and tokens** live in the main process ([`chatgpt-plan.ts`](../../../apps/studio/src/electron-main/lib/chatgpt-plan.ts)): a stable `urn:uuid:` host id, ID-token validation against OpenAI's JWKS, an encrypted store keyed by account subject that keeps the issued client id across sign-outs, a serialized refresh ahead of the one-hour expiry, and revocation on sign-out.
- **The provider** is a synthesized `chatgpt` config, like our own, whose key is the current access token ([`get-ai-provider-configs.ts`](../../../apps/studio/src/electron-main/lib/get-ai-provider-configs.ts)). Models come from the account's `/v1/models` catalog, which is `{ models: [{ slug, display_name, visibility }] }` rather than the API's list.
- **The request rewrite** happens in the local gateway ([`chatgpt-plan-request.ts`](../../../packages/ai-gateway/src/lib/providers/chatgpt-plan-request.ts)): `store: false` and `stream: true` always, the refused fields (`max_output_tokens`, `user`, `temperature` and the rest) dropped, system items rewritten as developer items, and a request that asked for JSON collapsed from `response.completed`. The platform gateway is never involved.

Since landed on this route: Continue with ChatGPT on the login screen (`f6d266516`), a settings card (`settings/chatgpt-plan-card.tsx`), and a spent or declined plan reported as a usage-limit error rather than retried (`822768ad7`, `c38549d8f`). Not rechecked here: whether plain top-level function tools are accepted (the docs say to group them in namespaces or send them as `additional_tools`), and image generation and hosted web search needing another provider.

## Approach

Ship Codex first. The terms are friendlier, bundling is allowed, and it answers every architectural question that Claude Code also raises. Claude Code follows as detect-only, meaning a CLI the user installed themselves, until we choose to take on the Commercial Terms for bundling.

We drive the CLIs directly rather than through AI SDK v7's `@ai-sdk/harness-*` adapters. Those adapters are experimental, and the Claude Code and Codex ones run the harness as a bridge process inside a network sandbox that the host reaches over a WebSocket. That is a poor fit for a local Electron app that already has its own sandbox.

### 1. Serve our tools over MCP

Today we only consume MCP ([`lib/apps/mcp/`](../../../packages/workspace/src/lib/apps/mcp/)). Add a loopback MCP server per agent session that serves that agent's tool set. Each tool's Zod input schema becomes the MCP input schema, and each call goes through the existing [`runToolCall`](../../../packages/workspace/src/lib/run-tool-call.ts), so containment, skills mounts and task context are unchanged.

Both CLIs then see exactly our tools:

- Claude Code: `--mcp-config` with `--strict-mcp-config`.
- Codex: an `mcp_servers` entry via `-c`, rather than the app-server's experimental `dynamicTools`, so both harnesses share one tool surface.

### 2. Turn the harness into a model plus our tools

Every built-in tool is switched off, so the harness never touches the host filesystem or shell outside our sandbox.

- **Claude Code:** `--tools ""`, `--system-prompt-file` with our composed prompt, `--input-format stream-json --output-format stream-json`, and one long-lived process per session resumed with `--resume`.
- **Codex:** the app-server over stdio, with `shell_tool` disabled, a `read-only` sandbox policy, and our instructions. Confirm which instructions key actually replaces the base prompt: `base_instructions`, `developer_instructions` or `model_instructions_file`.

Both have to be tested for the prompt really being replaced, and for no built-in tool leaking through, on every CLI version we accept.

### 3. A harness provider type

Add `claude-subscription` and `codex-subscription` beside the existing bring-your-own-key and local provider types ([provider configs](../../../packages/ai-gateway/src/schemas/provider-config.ts), [provider metadata](../../../packages/ai-gateway/src/lib/providers/metadata.ts)).

- The config holds no key. It holds the resolved binary path and version.
- Detection looks where people actually install these CLIs: `PATH`, Homebrew, npm's global folder, `~/.local/bin`, and the Codex binary inside Codex.app or ChatGPT.app.
- Set a minimum version, and show how to upgrade when the installed one is older.
- Signed-out state: show the exact command to run in Terminal, and re-check when the window regains focus.
- The models a plan offers come from the CLI, not from our model catalog.

### 4. Let a harness own the loop

This is the main change. The [agent machine](../../../packages/workspace/src/machines/agent.ts) runs one `streamText` call per step and executes tools itself ([`llm-request.ts`](../../../packages/workspace/src/logic/llm-request.ts)). A harness runs every step of a turn itself and calls our tools back over MCP.

- Add a harness request mode: one request spans many steps, the machine does not dispatch tool calls, and stop and abort map to interrupting the CLI.
- Map harness events to our message parts as they stream: text, reasoning, tool call, tool result. Tool parts arrive already executed, and their names are our names because they came through our MCP server. So [`llm-request.ts`](../../../packages/workspace/src/logic/llm-request.ts)'s unknown-tool fallback (`tool-unavailable`) should never fire. If it does, that is a leak to fix, not a case to render.
- Fill assistant metadata (`modelId`, `providerId`, usage, finish reason) from the harness's result events. Cost is zero to us, and usage counts are informational only.

### 5. History across providers

The harness keeps its own conversation state, keyed by its session id, which we store on the session. Switching a task between a harness and one of our gateway models means the next side has not seen the other's turns:

- Gateway after harness: replay from our persisted parts, which works today.
- Harness after gateway, or a cold harness session: start a new harness session primed with a transcript of our history. This is lossy, because reasoning and binary tool output become text.

Decide whether to allow switching mid-task at all, or to lock a task to the provider it started on.

## Phases

1. **Spike (Codex):** the loopback MCP server, the app-server over stdio with built-ins off, and one task end to end through the harness mode. Proves steps 1, 2 and 4.
2. **Codex product slice:** detection, sign-in guidance, the provider entry in the model picker, stop and abort, persistence, revocation handling.
3. **Claude Code:** the same slice for a user-installed `claude`.
4. **Evals:** `pnpm eval run` through each harness on the standard cases, compared with the same model through the gateway, to catch prompt-override or tool-surface regressions.

## Open questions

- Does replacing the whole system prompt and every built-in tool still count as "ordinary, individual usage"? The flags are documented, but the terms do not address it. Could this be tolerated at small scale and then targeted later?
- Plan rate limits are shared with the user's own CLI use. How do we show "your plan's limit is reached" when the CLI reports it?
- Codex app-server is experimental. How much protocol churn should we expect, and should we pin a CLI version range?
- Windows: both CLIs ship Windows builds. Detection paths and process-tree kills need their own pass.
- Monetization: subscription users pay us nothing for inference, so what they pay for has to be the product itself.
