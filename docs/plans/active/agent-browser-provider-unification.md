# One agent-browser Command via an Instrument Browser Provider Plugin

Supersedes the earlier "task-browser / external-browser command split" plan.
Screenshot capture work is explicitly out of scope.

## Summary

Keep a single agent-facing `agent-browser` command. Route the default path
through a new Instrument `browser.provider` plugin (`--provider instrument`)
that resolves the task-scoped Electron browser's CDP URL. External browsing
becomes the upstream vocabulary on the same command: `--auto-connect`,
`--cdp`, `--provider <cloud>`, `--profile`, etc., which agent-browser already
resolves with higher precedence than a configured provider.

The policy boundary moves from "two command names" to "which connection
identity this invocation resolves to". The wrapper stays, but shrinks from a
broad flag blocklist to: harness-owned settings (session, config, plugins,
namespace) plus meta subcommands.

## Why this beats the two-command split

- Upstream connection identity precedence is exactly the selector we need:
  `--cdp` > `--auto-connect` > `--provider` > local launch
  (`cli/src/native/actions.rs`, `launch_connection_identity`). Setting
  `AGENT_BROWSER_PROVIDER=instrument` via env makes the task browser the
  default, and any external flag on a single invocation overrides it without
  unsetting anything.
- One skill, one vocabulary. Upstream docs, examples, and bundled skill
  content transfer verbatim; no rewrite of every example to a renamed
  command, and no drift between two near-identical skills.
- `--provider instrument` is explicitly invocable, so the agent can force
  the task browser in a context where it had been using external flags.
- The daemon already handles switching: a connection-identity change within
  a session triggers a clean relaunch (disconnect + reconnect). Our
  WebContentsView survives disconnects; Studio's XState machine owns its
  lifecycle, and the daemon idle timeout (30s) already disconnects today.

## Mechanism facts (verified against agent-browser 0.28+; we pin ^0.31.1)

- Plugin system landed in 0.28.0. A `browser.provider` plugin is an
  executable that reads one JSON request from stdin and writes one JSON
  response to stdout (`agent-browser.plugin.v1`). For `browser.launch` it
  returns `{ browser: { cdpUrl, directPage, metadata, cleanup } }`; it also
  receives `browser.close` with the `cleanup` body.
- Plugin registry: `plugins` array in config, or `AGENT_BROWSER_PLUGINS`
  env var (JSON, replaces config discovery). Provider selection:
  `provider` config key / `AGENT_BROWSER_PROVIDER` env / `--provider` flag.
- Precedence: user config < project config < `AGENT_BROWSER_*` env < CLI
  flags. Our wrapper injects env, so agent CLI flags override our default
  provider by design; that is the external escape hatch.
- `directPage: true` skips target discovery and pins agent-browser to a
  single page-level websocket (no tab list). `directPage: false` runs
  normal discovery against the returned browser-level URL.

## Changes

### 1. Instrument provider plugin (packages/workspace)

Small cross-platform script implementing three request types:

- `plugin.manifest`: `{ name: "instrument", capabilities: ["browser.provider"] }`
- `browser.launch`: return
  `{ cdpUrl: ws://127.0.0.1:<serverPort><CDP_PAGE_PATH_PREFIX><targetId>, directPage: false }`.
  The URL travels in the plugin registry's `args` (`[pluginPath, cdpUrl]`),
  not env: the registry is re-read from the client env on every invocation
  and forwarded in the command envelope, so a bridge URL change never leaves
  a stale value in a long-lived daemon's environment. `directPage: false`
  keeps the existing cdp-bridge behavior: the bridge already synthesizes
  single-target `Target.*` discovery, so no bridge changes.
- `browser.close`: success no-op. Studio owns view lifecycle; the reaper
  (`agent-browser-cleanup.ts`) is unchanged.

Packaging: spawn via `process.execPath` + `ELECTRON_RUN_AS_NODE=1` in the
injected env so the plugin runs under Electron's node on packaged builds
(the agent-browser binary is native Rust; the env var is inert for it and
inherited by the plugin spawn). Registry injected as
`AGENT_BROWSER_PLUGINS='[{"name":"instrument","command":"<execPath>","args":["<plugin.js>"],"capabilities":["browser.provider"]}]'`.

### 2. Wrapper rework (packages/workspace/src/lib/shell-commands/agent-browser.ts)

- Stop injecting `--cdp`. Inject `AGENT_BROWSER_PROVIDER=instrument` and
  `AGENT_BROWSER_PLUGINS` instead.
- Unblock external targeting flags: `--auto-connect`, `--cdp`,
  `--provider`, `--profile`, `--state`, `--restore*`, plus already-allowed
  launch flags (`--engine`, `--executable-path`, `--device`, `--args`,
  `--proxy`, `--user-agent`).
- Still harness-owned (blocked as flags, env nulled): `--session`,
  `--namespace`, `--config`, `--session-name`, and the
  `AGENT_BROWSER_PLUGINS` / `AGENT_BROWSER_PROVIDER` /
  `AGENT_BROWSER_CONFIG` env passthroughs from the agent's shell, so the
  agent cannot re-point the plugin registry or session identity.
- Still-blocked subcommands: `plugin`, `install`, `upgrade`, `mcp`,
  `dashboard`, `doctor`, `chat`, `skills`. Revisit `auth`, `connect`,
  `close`, `session`, `state` once external flows exist; keep blocked in
  v1 (external identity must be carried as flags on each invocation, which
  keeps routing stateless).
- Session derivation: when an invocation carries an external identity flag
  (`--cdp`, `--auto-connect`, or `--provider` other than `instrument`),
  inject `--session <sessionId>-ext` instead of `--session <sessionId>`.
  Task and external browsers then coexist without relaunch thrash, and a
  bare follow-up command always means the task browser.

### 3. Skill updates (sibling checkout of instrument-org/skills, then bump registry/)

One `agent-browser` skill, edited in place:

- SKILL.md: default is the Instrument task browser; add an "External
  browsers" section with the selection policy from the original plan
  (existing logged-in state, bot-blocked sites, explicit user request,
  iOS/provider/CDP targets; fall back task<->external on login walls or
  connect failure). State that external flags are per-invocation.
- `references/session-management.md`, `references/proxy-support.md`, and
  the commands reference currently say connection/profile/state flags are
  blocked; rewrite to describe the provider default and the allowed
  external flags.
- Examples keep the `agent-browser` name everywhere (no rename pass
  needed).

### 4. Out of scope / later

- Screenshot capture changes: none (explicitly dropped).
- Permission/approval UX for acting inside the user's real Chrome
  (consequential actions on logged-in sessions). Note for a follow-up;
  candidates are wrapper-level confirmation or agent-browser
  `--confirm-actions` / action policy.
- `directPage: true` simplification of the cdp-bridge Target synthesis.
- Stealth (`launch.mutate`) and credential-vault plugins fit the same
  registry later.

## Risks

- Plugin spawn on packaged builds (execPath + ELECTRON_RUN_AS_NODE) needs a
  smoke test on macOS and Windows.
- Windows uses TCP daemon sockets; verify `-ext` session naming and
  provider env behave identically there.
- Allowing `--profile` / `--auto-connect` widens what the agent can touch
  (the user's running Chrome). The skill guidance is the only guardrail in
  v1; see permission follow-up above.
