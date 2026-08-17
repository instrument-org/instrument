# Plan: cut the harness cost of an agent driving Studio

Status: proposal, partly addressed. Owner: TBD. Evidence base: every Claude Code session recorded against this checkout, 2026-07-07 through 2026-08-14, plus the dev-instance logs under `apps/studio/.logs/`. Complements [../findings/driving-studio-for-ui-capture.md](../findings/driving-studio-for-ui-capture.md), which catalogued the traps found in one capture run; this one measures how much they cost across every run since, and which ones survived the fixes that finding proposed.

Boot latency has since been worked on directly: `studio-drive boot` polls at 100ms instead of 2s and spawns `electron-vite` rather than paying for the `pnpm run` and `cross-env` hops, and the renderer dev server warms only its entry after warming the whole route tree turned out to delay first paint by about a second. Those cut the fixed cost of a boot. They do not touch the two things that dominate a long run: reload landing mid-run, and waiting for a route to finish filling in.

Out of scope: build and boot speed (owned elsewhere), and the eval harness (owned elsewhere). This is about an agent driving the running app.

## What the sessions show

56 sessions drove the app. Across them, 1,808 shell calls act on Studio rather than read source about it, and those calls account for **5.3 hours of wall time**. The distribution is what matters: the median driving session spends about a minute in the harness, and the worst ten spend 10 to 61 minutes each. The cost is concentrated in exactly the sessions doing the most valuable work, which are long multi-surface capture and repro runs.

**44% of driving commands contain an explicit `sleep`, totaling 134 minutes of hardcoded waiting.** That is the single largest line item and the clearest signal of a missing affordance. The sleeps are not idle padding, they are guesses: 383 of them are followed immediately by a `chrome-devtools` invocation, 52 by a `curl` at `/json/version`. The agent is polling for readiness with a constant because nothing tells it when the app is ready. The chosen constants cluster at 2s, 1s, 3s, 4s, 5s, 6s, which are too short to be reliable and too long to be free, and 54 calls wrap the whole thing in a hand-rolled `for i in 1 2 3` retry loop.

## The problems, in leverage order

### 1. Hot reload is an uncontrolled hazard — the destructive half is now off for driven instances

`apps/studio/electron.vite.config.ts` set `watch: {}` on all three builds with no env escape hatch, so any write anywhere in the checkout reset the app under a run in flight.

The two halves turned out to be worth separating, because they are not equally destructive and they are not equally useful. A **main** rebuild runs electron-vite's watch hook, which is `ps.kill(); startElectron()` — a hard kill, no graceful teardown. A **preload** rebuild sends the renderer `{type: 'full-reload'}`, which per [../findings/app-reload-destroys-the-task-browser.md](../findings/app-reload-destroys-the-task-browser.md) destroys every task `<webview>` and closes the `agent-browser` sessions under a running agent. Renderer HMR, by contrast, costs component state that a run can re-establish.

Two measurements settled it. Of 2,359 driving commands in the corpus, only **146 (6.2%)** followed a renderer edit with no reboot in between — the edit-then-look loop HMR exists for — and 26 followed a main or package edit, where watch forced a relaunch and HMR contributed nothing. And of 1,561 recorded dev instances, **1,039 (67%) had a successor log `Detected non-graceful exit from previous session`** against 147 that recorded a graceful quit. Two thirds of every Studio instance this repo has run were hard-killed, the large majority by a watch relaunch nobody asked for: August saw 442 process starts against 62 deliberate `boot` commands.

`DISABLE_DEV_RELAUNCH=true` now sets `watch: null` on main and preload, and `studio-drive.mjs boot` sets it (`--hot` opts out). Renderer HMR is untouched. This is scopable in a way the earlier draft of this section assumed it was not: `boot` spawns its **own** `electron-vite dev` on a hash-derived port in 48161-48360, never the conventional 48160, so a hand-started instance keeps hot reload on all three targets and is unaffected. Verified by touching `src/electron-main/index.ts` against both: the frozen instance kept its pids and logged no rebuild, the `--hot` control relaunched and logged `restarting electron app`.

What this does not cover, and what item 4 of the ordering below is still for: renderer HMR from another agent's `src/client` edits still lands in a driven instance, and a change HMR cannot apply still reloads the page. That is the residue the reload reporter exists to surface.

The evidence that this is a real and recurring tax is that **humans have had to work around it in their own messages five separate times**, twice by routing the work elsewhere rather than by apologizing:

- 2026-07-15: "sorry, i had another agent running, which was causing hot reloading for you. i stopped."
- 2026-07-31: "Also, bearing in mind that if you make any code changes, it'll hot reload and also clear this state."
- 2026-07-31: "Sorry, I was making a commit on the main branch at that moment. I probably broke that last screenshot or two."
- 2026-08-12: "let's do this in a work tree though, off of the branch of main that's local right now, just because other agents are working and don't want it to cause a hot reload." — a worktree bought to purchase what a flag should.
- 2026-08-12: "partway through this, another agent was editing files in the workspace, which caused some hot reloads. So, that'll be some of the behavior you see going on in there." — a human pre-explaining contaminated evidence to a reviewing agent.

A mechanism whose correct operation depends on a human remembering not to type is not a mechanism. And the agent cannot see it happen: the failure presents as a click that stopped working, a screenshot of the wrong route, or a repro that evaporated. One session recorded exactly that misattribution: "The main process auto-relaunched from my edits (hot reload), which reset all guests, that's why the old stuck session is gone (not a demonstration of the fix)." The agent had nearly reported a bug as fixed.

Worse, reload can leave the app in a state no reload clears. The most expensive session in the corpus (61 minutes in the harness) ended: "the running instance stopped executing changes to `view.tsx`, I proved it by changing the visible string to 'HMRPROBE not found' and watching the app keep rendering 'File not found'. After that the viewers stopped mounting at all. Restarts and hard reloads didn't clear it, and I stopped rather than keep burning time on the harness." A separate session found the mechanism for one class of this: a live query that ends without yielding throws, retries on backoff, and settles into a permanent error state, after which no change reaches the UI for the rest of the session. A reload or an aborted subscription is enough to trigger it.

The instinct that hot reload is usually right is correct, and the fix was not to turn it off globally. The asymmetry is that HMR serves a human iterating on a component and actively harms a script that has spent twenty steps navigating to a state. Freezing main and preload for driven instances takes the destructive half without touching the useful one, and without a lease, a thaw, or a lifetime to get wrong: the mode is fixed when the dev server starts, `boot` reports it as `hot`, and stopping the instance is what changes it. A `--hot` boot that disagrees with a running instance says so rather than silently reusing the other mode.

What is still open is the renderer half, which the freeze deliberately leaves alone and which no longer has an obvious answer: suppressing HMR would mean a driven instance whose `src/client` code is stale in a way nothing announces, and that is the fail-safe problem the earlier draft of this item worried about. Worth revisiting only if the reload reporter turns out to be insufficient in practice.

Note that the two-dev-servers-share-`out/main` variant of this is already fixed (`emptyOutDir: isProduction`, see [../findings/dev-rebuild-wipes-live-main-bundle.md](../findings/dev-rebuild-wipes-live-main-bundle.md)). Freezing main compounds well with it: a driven instance is no longer a *writer* of `out/main`, and because superseded chunks are content-hashed and never deleted, another dev server's rebuilds cannot pull a chunk out from under its frozen process either.

### 2. There is no "wait until ready" primitive, so agents guess with `sleep`

The 134 minutes above are the direct cost. The indirect cost is worse: a guess that is too short produces a failure the agent then debugs as if it were real, and a guess that is too long is invisible waste that nobody profiles.

`studio-drive` already has `wait`, and it is measurably better than the CLI (35% of its calls carry a sleep versus 48% for the CLI, and it burned 545 seconds of sleep versus 4,102). It is not yet enough, because it waits on a DOM expression and the common need is coarser: wait for the debug port, wait for the renderer to finish its first paint, wait for the route to settle, wait for the agent turn to finish streaming. One session hand-rolled the port wait and logged the result: `UP after 36s`, against sibling attempts of 4s and 8s. That eight-fold spread is why constants do not work here.

`boot` is not the gap. It has returned only once `window.__studioDrive` exists since the script was introduced, and it now polls for that at 100ms rather than 2s. The residual gap is everything after boot: the handle appears when the app can be driven, not when the restored route has finished loading, so a `shot` fired straight after `boot` can still catch a pane filling in. That is now documented, with `wait` on a DOM predicate as the answer.

What would help:
- Coarse `wait` modes — `--route <path>`, `--idle`, `--settled` — so waiting for the common states does not require composing a DOM predicate per surface. Documenting the predicate tells an agent it must invent one; a named mode is the thing it will actually reach for instead of `sleep`.
- Make every command implicitly wait for readiness rather than failing fast on a mid-reload app. The current `Nothing is mounted yet (mid-reload?)` message tells the agent to re-run by hand, which is a `sleep` by another name.

### 3. The Chrome DevTools CLI misattributes Studio failures to Chrome

By far the most common connection error in the corpus, and the one that reliably sends the agent to the wrong process:

```plaintext
Could not connect to Chrome. Check if Chrome is running.
Cause: Failed to fetch browser webSocket URL from http://127.0.0.1:48160/json/version: fetch failed
```

There is no Chrome. There is a Studio Electron instance that is not running, or is running on a different port, or has just been relaunched by the reload the agent did not know about. The agent's next move is consistently wrong: 68 calls across 19 sessions are port-scanning loops (`for p in 48160 48161 48162`), and 54 calls across 13 sessions are `pkill` sweeps that in at least one case the agent had to reason carefully about to avoid killing another worktree's processes.

The CLI has two further papercuts that are individually trivial and collectively noisy. Its daemon does not notice when the app it points at dies, so the error above is emitted long after the useful moment. And 293 of 1,105 CLI invocations omitted `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1`, leaving 156 outputs polluted with an update nag or a Google telemetry banner that the agent then has to parse around. Requiring an env var on every invocation to get clean output is a contract nobody keeps.

`connect-cli.sh` already solves this for itself (`CHROME_DEVTOOLS=(env CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1 pnpm exec chrome-devtools)`), but agents call `pnpm exec chrome-devtools` directly instead. A `scripts/cdt` wrapper that sets the env and passes `--no-usage-statistics` (a server arg, so it only matters on `start`) makes the quiet path the short one. Two lines, and the skill can then name one invocation rather than one invocation plus an env var to remember.

### 4. Two mechanisms, and the better one has not displaced the worse one

`studio-drive.mjs` was built to replace the CLI for this use, and it works: it speaks CDP directly, so there is no daemon to go stale, and its error-output rate is 29% against a much higher rate of hard connection failures for the CLI. But adoption is partial. In August, 343 calls went through `studio-drive` and **177 still went through the CLI**. Every CLI call in that window is an agent reaching past the purpose-built tool for the one with the known failure modes.

Two things likely drive this. The skill still documents the CLI as a co-equal option under "The CLI, for interactive inspection", and the CLI genuinely has input primitives the agent may not realize `studio-drive` also covers. Worth either closing the capability gap and demoting the CLI to a troubleshooting note, or stating plainly in the skill which one to reach for first and why.

### 5. Instance identity is derived, not stated, and gets it wrong across checkouts

`studio-drive` derives its port from a hash of the checkout path, which correctly stops an agent and a human fighting over one window. The failure mode it introduces is that running the wrong copy of the script targets the wrong app, silently. Observed in one session: main's script invoked from a worktree resolved to main's port and reported `window.__studioDrive never appeared`, while the same script run from main reported `Nothing is running for this checkout.` Neither message names the checkout it resolved, so the agent cannot see that the *path* was the problem.

Cheap fix: have every command print the resolved checkout root and port on failure, and have `boot` refuse when the script's own location and the working directory disagree.

Related ambient mess worth a look: one session enumerated the installed application names and found `Instrument (1782333246124)`, `Instrument (1782936742798)` and five more like them, alongside `Instrument (Dev (abselftest))`. Fixture and test boots appear to be leaving per-run app identities behind.

### 6. The `eval` contract is still a guessing game

Small but recurring. Observed failures include `studio-drive: ReferenceError: await is not defined`, `SyntaxError: Function statements require a function name`, and `Unknown command undefined.` The CLI's `evaluate_script` requires an anonymous `function () {}` while `studio-drive eval` accepts either, and the skill documents this in one line that is easy to miss. An error naming the accepted forms would close it.

## Suggested order

1. A `scripts/cdt` wrapper carrying the env, and a skill that names `studio-drive` as the entry point with the CLI demoted to troubleshooting. Two small edits, no design work, and together they retire the telemetry noise and most of the 177 calls a month still going down the flakier path.
2. Failure messages that name the resolved checkout root and port. `window.__studioDrive never appeared` currently describes the symptom and not the cause, which is usually that the script and the working directory belong to different checkouts.
3. Coarse `wait` modes. The largest remaining share of the 134 minutes of sleeps, now that boot is no longer the culprit.
4. Clean up leftover per-run app identities.

Landed since: the main/preload freeze described in problem 1, which was the item this list ranked hardest. It needed a decision rather than an implementation, and the decision was to split the two halves of hot reload instead of leasing one freeze over both.

## Related

- [../findings/driving-studio-for-ui-capture.md](../findings/driving-studio-for-ui-capture.md) — the trap catalogue and what has already landed against it.
- [../findings/dev-rebuild-wipes-live-main-bundle.md](../findings/dev-rebuild-wipes-live-main-bundle.md) — the concurrent-dev-server variant of the reload hazard, fixed.
- [seeded-test-workspaces.md](seeded-test-workspaces.md) — `boot --workspace` removes the ambient-state dependency; adoption is 3 sessions so far.
- `.agents/skills/studio-chrome-devtools/SKILL.md` — the operator's guide these problems are felt through.
