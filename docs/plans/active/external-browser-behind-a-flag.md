# Plan: external browsers behind a feature flag

Status: landed, feature off. The capability is built and tested; the `external_browser` flag ships off, and this plan is the checklist for turning it back on.

## Why it is off

Driving a browser outside the app means launching the user's installed Chrome. macOS attributes that child process's writes to its own bundle back to the responsible process, which is us, so the first launch raises a system permission prompt ("wants to manage apps on this Mac", Privacy & Security > App Management). That prompt arrives with no explanation, in the middle of an agent turn, on behalf of an app the user did not knowingly point at Chrome. Denying it is sticky and the recovery is a manual Settings toggle.

Nothing about the feature is broken. What is missing is a consent story: the prompt has to be something a user is expecting, understands, and can retry after refusing.

The exact TCC service was not confirmed. Reproduce with `log stream --style compact --predicate 'subsystem == "com.apple.TCC" AND category == "access"'` and read the service name: `kTCCServiceSystemPolicyAppBundles` is App Management, `kTCCServiceSystemPolicyAppData` is "access data from other apps", `kTCCServiceAccessibility` is "control your computer". Do it against a signed, packaged build; TCC keys on code signature and responsible process, so a dev build is not representative. The deep link and the copy below assume App Management, and both are a one-line change if it turns out to be another pane.

## What macOS lets us do about it

Very little, and this was checked against the Electron source rather than assumed. Electron's only permission entry points are `systemPreferences.askForMediaAccess` (camera and microphone), `systemPreferences.getMediaAccessStatus` (camera, microphone, screen), and `systemPreferences.isTrustedAccessibilityClient` (Accessibility, which can raise its own prompt). There is no equivalent for App Management or App Data: no way to request consent, no way to read back whether it was granted, and no way to raise the prompt on demand. It appears when Chrome performs the write, not when we ask.

So the affordance is a link, not a request. `features.openAppManagementSettings` opens the pane; the Features settings row shows it when the flag is on. That is the ceiling unless the prompt turns out to be Accessibility, in which case `isTrustedAccessibilityClient(true)` would let us trigger it deliberately at a moment of our choosing.

The other way out is to stop touching the user's installed Chrome at all: launch a separate Chrome for Testing binary and point it at a copy of the profile. That sidesteps app-bundle modification entirely, and is worth measuring before building consent UI for a prompt we could avoid.

## The flag

`external_browser` in `apps/studio/src/shared/features.ts`, stored per user in the features store, toggled from Settings > Features (a pane only developer mode shows). `isFeatureEnabled` in `apps/studio/src/electron-main/stores/features.ts` reads it.

It reaches the workspace as `WorkspaceConfig.isExternalBrowserEnabled`, a function rather than a boolean: the config is built once at boot, and the flag is a live store the user can toggle without restarting. Enforcement follows immediately. The system prompt does not, because the session-context message is cached for up to 60 minutes; a session open across a toggle keeps the old browser guidance until it rebuilds.

## What the flag gates

- `packages/workspace/src/lib/shell-commands/agent-browser.ts` refuses any invocation carrying `--cdp`, `--auto-connect`, `--provider`, `--profile`, `--state`, `--restore*`, or `--executable-path`, and the `profiles` subcommand. Refused, not ignored: dropping the flag and running anyway would answer the command on the managed browser while the agent believed it was acting as the user's signed-in identity.
- The same file's `agentBrowserCommandDescription()` and `--help` output drop their external sections.
- `browserTargetingGuidance()` in `packages/workspace/src/agents/main.ts` swaps the two targeting paragraphs for one line saying the task browser is the only browser and sign-in happens there.
- `packages/workspace/src/tools/bash.ts` builds its description per call so the command list reflects the current flag state.

Off is the default everywhere except the dev harnesses (`evals/`, `scripts/`), which enable it so the `browser-selection` eval cases and `run-bash` still exercise the real path.

## Turning it back on

1. Confirm the TCC service, then decide between consent UI and avoiding the prompt (Chrome for Testing).
2. Flip `external_browser` on by default, or remove the flag and its gate sites listed above.
3. Restore the skill content. It was removed from the `instrument-org/skills` repo rather than gated, because skill bodies are read verbatim and the frontmatter description feeds the always-present catalog, so a stale mention there advertises a capability the build refuses. Recover it from the commits that added it: `090dfb2`, `05b17d4`, `94a994f`, `d6cf026`. The removal touched `SKILL.md` (frontmatter description, intro, the "Choose an approach" table, the External browsers section, two invariants) and `references/{authentication,commands,proxy-support,session-management}.md`.
4. Re-check the two known rough edges before shipping: an explicit `AGENT_BROWSER_IDLE_TIMEOUT_MS` overrides upstream's "never close a headed browser" exemption, so a visible external window is closed five minutes after the agent's last command even while a human is typing in it; and `download` against an external browser redirects that browser's download destination without resetting it.
