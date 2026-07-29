# One agent-browser Command via an Instrument Browser Provider Plugin

Status: **complete**. The provider plugin, the wrapper's connection-identity
routing, the sibling `-ext` daemon session, and the skill/prompt split have
landed. Selection behavior is guarded by the `browser-selection` evals, which
pass across models for all eight cases. Two things are deliberately
outstanding: the packaged-build and Windows smoke tests under Risks, which no
automated check can stand in for, and the permission UX for consequential
actions inside the user's own browser, which is a follow-up rather than part
of this work.

Tracking: [FP-1193](https://linear.app/finalpoint/issue/FP-1193/allow-agents-to-use-external-browsers),
whose comments carry copy-paste prompts for the manual smoke tests.

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
  lifecycle, and the daemon idle timeout
  (`AGENT_BROWSER_IDLE_TIMEOUT_MS`, five minutes) already disconnects today.

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
  `dashboard`, `doctor`, `chat`, `skills`, `inspect`, `launch`, `stream`,
  and `batch`, whose lines are parsed as whole commands and would bypass
  this argv-level policy. `auth`, `connect`, `close`, `session`, and `state`
  stay blocked in v1: external identity must be carried as flags on each
  invocation, which keeps routing stateless. Revisit once external flows
  exist.
- `profiles` is allowed and always routes external, since it inspects the
  host's Chrome install rather than any browser. It is the only way the
  agent can see profile names: the installs and profile directories are not
  in the sandbox filesystem, and `scrubHostPaths` strips the host home out
  of its output.
- Session derivation: when an invocation carries an external identity flag
  (`--cdp`, `--auto-connect`, or `--provider` other than `instrument`),
  inject `--session <sessionId>-ext` instead of `--session <sessionId>`.
  Task and external browsers then coexist without relaunch thrash, and a
  bare follow-up command always means the task browser.

### 3. Skill and prompt (sibling checkout of instrument-org/skills, then bump registry/)

The mechanics live in the skill; the choice policy lives in the workspace
prompt. SKILL.md is capped at 5000 tokens by the skills repo's own
`check-skill.ts`, and the selection guidance did not fit beside the command
surface. The split is also the better home on its own terms: the prompt is
always in context while a skill is loaded on demand, and browser choice
governs the first invocation, often before any `load_skill` call.

- SKILL.md: commands drive the managed browser unless a targeting flag says
  otherwise, a flag applies only to the invocation it appears on, and a
  table of what each flag targets. Value rules models get wrong stay inline
  rather than in a reference (`--cdp` takes a bare port or an http origin;
  `--device` only means something alongside `--provider ios`). Instrument
  framing stays out, so the skill reads the same for any host of the CLI.
- `packages/workspace/src/agents/main.ts`: when an external browser is the
  right reach, that targeting is per invocation, and the consent and
  re-verification rules that apply when acting as the user's signed-in
  identity.
- `references/session-management.md`, `references/proxy-support.md`, and the
  commands reference describe the provider default, the allowed external
  flags, and the full `--cdp` value rules.
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
  (the user's running Chrome). Prompt and skill guidance are the only
  guardrail in v1; see permission follow-up above. The evals cover selection
  and the consent wording on a read-only request, but nothing yet tests
  whether a model actually stops before a _mutating_ action in the user's
  browser, because an honest test of that has real side effects.
- Upstream's `download` sets the browser's download directory and never
  restores it, so running it against the user's own Chrome redirects their
  later downloads until that browser restarts. Recorded in
  [agent-browser-download-behavior-not-reset.md](../../findings/agent-browser-download-behavior-not-reset.md);
  the skill steers away from `download` on an external target.
