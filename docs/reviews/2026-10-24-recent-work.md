# Recent work after the 10-22 review

Reviewed: `65ba30fde..acc5ab7ec` (126 commits; 368 files changed, 12,848 insertions and 4,118 deletions).

The starting point is the head the 10-22 review recorded. Five blind readers took one area each, following `REVIEW.md`: the in-app browser and agent-browser; secrets, redaction, logs and problem reports; agent turns, message assembly and chat files; sign-in, setup, microphone and updates; developer and release tooling. Every Important finding below was re-read at `acc5ab7ec` by the reviewer who wrote this file, and a reader's claim that did not survive that read was dropped (one: browser screenshots stored inline in the logs, which `part-blobs.ts` already moves into `blobs/`). The 10-22 findings A, B and C were rechecked in the same pass; their files did not change in this range, and A is recorded there as not a defect.

## Findings

### A. A browser screenshot brings a refused image into the model's context through a link

- Status: fixed `a20f8a148`
- Where: [browser-screenshot.ts:36](/packages/workspace/src/lib/browser-screenshot.ts#L36), [agent-browser.ts:962](/packages/workspace/src/lib/shell-commands/agent-browser.ts#L962), [bash.ts:472](/packages/workspace/src/tools/bash.ts#L472)
- What: after a bash call whose `agent-browser screenshot` succeeded, the app reads the saved file itself with a plain `fs.readFile`, which follows links, and attaches it to the result. The read happens after the whole call has run, so `agent-browser screenshot shot.png && rm shot.png && ln -s <a picture in a Not allowed folder> shot.png` in one call sends that picture to the model. Creating the link is an ordinary write in the work folder. `read_file` refuses the same link through `tool-fs`; this path has no check. Crosses threat-model line 1, and line 88 says a link the agent planted is not a race.
- Verification: the browser reader's Vitest probe called `browserScreenshot` on a link into a refused folder and got the image back. The `readFile` call was confirmed by reading; the probe was not re-run.
- Fix: open the screenshot with `openOwnFile` (no-follow) or read it through the session's tool filesystem, as `read_file` does.
- History: introduced by `72ca38e4e`. Its trailers cover one image per call and pruning, not how the file is opened.

### B. The secret rules miss the key formats Instrument's own providers use

- Status: fixed `30ce660da`
- Where: [secrets.ts:40](/packages/shared/src/secrets.ts#L40), [secret-scan.ts:89](/packages/workspace/src/lib/apps/secret-scan.ts#L89)
- What: `findSecrets` has no rule for `sk-or-` (OpenRouter), `xai-` (Grok), `csk-` (Cerebras), `fw_` (Fireworks), `sk-api-` (MiniMax), or a plain `sk-` key (DeepSeek, OpenCode Zen, older OpenAI keys); its OpenAI rule needs `T3BlbkFJ`. These are the formats `ai-gateway`'s provider metadata lists for bring-your-own-key. So `cat .env` with an OpenRouter key reaches a problem report's chat files and the app log unredacted, `memory save` and `app guide` accept it, and an app folder holding it passes the scan that the old `\bsk-[\w-]{16,}\b` pattern, dropped in `4da821ad5`, used to catch.
- Verification: the secrets reader's probe got `[]` from `findSecrets` for each format. The rule list and the removed pattern were confirmed by reading.
- Fix: a prefix rule per provider key format, driven from or checked against the provider metadata so a new provider cannot be missed.
- History: `2e8e3a610` and `4da821ad5`. `Rejected: gitleaks' generic-api-key rule` concerns name-based matching; prefix rules have no such false positives, so it does not cover this.

### C. land.sh deletes a worktree's untracked files after landing

- Status: fixed `c060eb1dc`
- Where: [land.sh:42](/scripts/land.sh#L42), [land.sh:227](/scripts/land.sh#L227)
- What: the clean-tree check passes `--untracked-files=no`, and the cleanup runs `git worktree remove --force`, which deletes untracked files with the worktree. An agent that created a file and forgot to add it lands the branch without it, and the file is gone with no warning.
- Verification: the tooling reader reproduced it in a scratch repo; confirmed by reading.
- Fix: refuse to land (or keep the worktree) while `git status --porcelain` lists untracked files outside `registry/`; `--force` stays for the submodule.
- History: predates this range (`f99e0038c`); `7c600a87d` kept it.

### D. land.sh run from a subfolder skips lint and tests, then fast-forwards main

- Status: fixed `c060eb1dc`
- Where: [land.sh:27](/scripts/land.sh#L27), [land.sh:106](/scripts/land.sh#L106), [land.sh:145](/scripts/land.sh#L145)
- What: the script never changes into `$worktree_root`, while `$changed` is relative to the repo top. From `packages/workspace`, `[[ -f "$file" ]]` drops every changed file so oxlint never runs, `-f "$package/vitest.config.ts"` is false so no tests run, and knip's paths stop matching. Only types are checked before main moves.
- Verification: the tooling reader's scratch-repo run logged only `check:types` and knip from the subfolder, then landed; from the root it also ran oxlint and vitest. Confirmed by reading.
- Fix: `cd "$worktree_root"` after line 27.
- History: predates this range (`f99e0038c`); `7c600a87d` moved it into `run_checks`.

### E. A Windows home folder with a space or accent survives in a crash report's raw stack

- Status: fixed `5def57dcd`
- Where: [home-folder.ts:10](/packages/shared/src/home-folder.ts#L10), [build-event.ts:125](/packages/shared/src/exceptions/build-event.ts#L125)
- What: renderer stack frames spell the home as a percent-encoded `file:///C:/Users/Jos%C3%A9%20Garc%C3%ADa/...`. `homeSpellings` has no encoded spelling, so the parsed frames come out as `~/...` (the parser decodes them) while `rawStack` keeps the full path and the account name, the leak `ec4781796` set out to close.
- Verification: the secrets reader's probe showed `rawStack` with the encoded path; the missing spelling was confirmed by reading.
- Fix: add the `encodeURI` form of each spelling.
- History: `ec4781796`.

### F. The log-in dialog counts a sign-in from an earlier opening as finishing the next one

- Status: fixed `b99f7f162`
- Where: [login-modal.tsx:46](/apps/studio/src/client/components/studio-modals/login-modal.tsx#L46)
- What: `signedIn` is a ref on the once-mounted modal, cleared only in `complete()`. `onDismiss` calls `setState(null)` directly, so after a Google sign-in that ends on the plan pages and leaves by Back then Done, the next caller to open the dialog gets its `onCompleted` when the person merely closes it: a tool card flips to Retry or Settings reopens unasked.
- Verification: the sign-in reader's probe rendered the real modal and saw the second opening's `onCompleted` fire on close; the missing reset was confirmed by reading.
- Fix: clear the ref when a new opening starts (`openKey` changes) or in `onDismiss`.
- History: `d5b80f2ee`.

### G. The Windows microphone card can show no way forward

- Status: not a defect
- Where: [microphone-access.ts](/apps/studio/src/electron-main/lib/microphone-access.ts), [dictation-settings.tsx:285](/apps/studio/src/client/components/settings/dictation-settings.tsx#L285)
- What: Electron on Windows answers `restricted` when system-wide microphone access is off. The card for `restricted` has no button, says "This Mac doesn't allow it.", and hides the microphone, language and sound settings. If Windows answers `not-determined`, Allow does nothing off macOS and the card never clears.
- Verification: static trace and Electron's Windows source only; not run on Windows. Medium confidence.
- History: `bafc2b9b5`, which carries `Not-tested: the Windows card and toast on a real Windows host`.
- Note: checked on the Windows test host with Electron 44.7.0, turning each switch in Settings › Privacy & security › Microphone: "Microphone access", "Let apps access your microphone" and "Let desktop apps access your microphone" each read `denied`, which the card shows with Open settings. `restricted` is left for a device whose policy refuses the microphone, where no setting the person can reach helps, and `not-determined` never came up for a desktop app. Writing those switches straight into the registry changes nothing Electron reads; only Settings does. `461e4bab2` names the computer in the `restricted` line.

### H. Nits

- A tab-cap closure notice is lost when the session ends up with no tabs: `isEmpty` at [state-notes.ts:35](/packages/workspace/src/lib/state-notes.ts#L35) treats `{ tabs: [], closed: [...] }` as empty after `takeClosedTabs` consumed the closures (reader's probe; `d0411fdc6`).
- The tab cap ranks by `hiddenForMs` alone ([tab-cap.ts:21](/packages/workspace/src/lib/chat/tab-cap.ts#L21)), so a task's tab it is driving right now, hidden since it opened, is the first closed; discard's ten-minute agent protection is not consulted.
- Log redaction covers an Error's `message`, `stack` and `cause` only ([log-redaction.ts:47](/apps/studio/src/electron-main/lib/log-redaction.ts#L47)); an `APICallError`'s `url`, `requestBodyValues` and `responseBody`, or a `URL` or `Map`, reach `main.log` whole. The commit scopes it that way.
- A crash's title is not run through the report redactor ([problem-reports.ts:126](/apps/studio/src/electron-main/lib/problem-reports.ts#L126)), so a name or email in an exception message goes out with automatic reports.
- `commit.sh` sorts paths in locale order and compares them with git's byte order through `comm` ([commit.sh:44](/scripts/commit.sh#L44)), refusing a valid commit under a UTF-8 locale; fails safe.
- Plus 5 similar: placeholders such as `Bearer YOUR_ACCESS_TOKEN` refused in guides and memories, a URL query over 8,192 characters left whole, one shared `land-knip.json` across concurrent landings, `=` in a `commit.sh` path read as a copy, and a sleep that can land while a command to the tab is in flight (`window-browser.ts:203`).

## Checked boundaries

- The sign-in `next` page accepts only `https:` on `tryinstrument.com` and its subdomains; no open redirect. `openExternal` accepts only http(s), mailto and tel.
- Cross-site iframe sessions: every `Target.*` command but `setAutoAttach` is answered by the task endpoint, `setAutoAttach` is rewritten to iframes only, and frame commands pass the page and frame gates.
- Image limits keep tool-call pairing and message shape intact, and only move the cached prefix when the cut moves. Held-back replies release on finish, abort, error and the crash sweep.
- `generate_image` writes through the session's rule-enforcing filesystem.
- `commit.sh` moves the branch only through `update-ref` with the old value, so it cannot undo a commit another session landed.
- The release Slack post runs only after publishing succeeds, and the Electron bump stays a devDependency.

## Not covered

No app run, Windows or Linux host, live OAuth, or real-model check. Not read: setup and billing copy, the update hover card's UI, `0df8bdac2`'s display changes, the remaining `cdp-bridge.ts` teardown, every `dispatch-command` frame override, two bridge connections on one tab with auto-attach already on, the rotating log writer's drain race, and `scripts/ci-report.ts`'s FAIL-line pattern against vitest 5. Probe results for A, B, E and F are the readers'; the reviewer confirmed each by reading the cited code, not by re-running them.
