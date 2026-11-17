---
name: first-run-tester
description: Put a Claude session in front of a released Studio build as a first-time or returning person, seeing only screenshots and acting only with a pointer and keyboard, thinking aloud, and collect where it stumbles. Use when asked for an agent usability test, a first-run or onboarding walk by a model, or "what would a new person trip on" for a build. Every run needs the owner's approval first; this skill never starts one on its own.
---

# First-run tester

A tester is one `claude -p` session with no tools of its own: no shell, no file reads, no web. Its only tools come from `scripts/lib/mcp-server.mjs`, which shows it a screenshot of a Studio window and lets it click, type, press keys, scroll, drag, wait, pick from a menu, note a stumble and finish. Each action carries what it sees, what it expects and how it reacts, so the steps log reads as a think-aloud. The app under test is a release tag's dev build, booted off screen inside a Seatbelt profile with a stand-in home, a test account and a seeded scenario.

It finds the small doubts a person has on a first launch: a word nobody explained, a button that did something else, two places to type. It does not replace a person: it is more patient than most, reads more, and never brings habits from a real Mac's other apps unless the persona tells it to.

```bash
S=$(git rev-parse --show-toplevel)/.agents/skills/first-run-tester/scripts

node $S/run.mjs preflight --checkout <release worktree>
$S/prove.sh <release worktree> returning-user <account file> <first name>   # the pre-run check
node $S/run.mjs boot --checkout <release worktree> --account <account file>
node $S/run.mjs tester --checkout <release worktree> --persona personas/returning-user-wandering.md \
  --name <run> --max-actions 90 --max-minutes 50           # prints the plan and stops
node $S/run.mjs tester ... --go                             # only after the owner approved this run
node $S/run.mjs report <run>
node $S/run.mjs stop --checkout <release worktree>
```

Every command takes `--work <folder>` (default `~/.instrument-first-run-tester`). It holds everything a run makes and nothing the repo keeps: `sandbox/` (the stand-in home, temp folder, generated profile, the copy of the account the app signs in with), `runs/<name>/`, `bin/onscreen`. Keep account files outside the repo too, mode 600, in a folder of their own beside it. Commands that boot Studio need the agent shell's own sandbox off, as `studio-drive` does. The tester runs on whatever Claude login `claude` finds: a session started under another config folder passes its `CLAUDE_CONFIG_DIR` on, so set it to the login the run should use.

## Safety

- **Each run needs the owner's approval** of its thesis (what it is meant to find) and its mechanism (build, scenario, persona verbatim, caps). `tester` without `--go` prints exactly that, for the approval. A rig failure spends the approval; ask again before another run.
- **Never on screen.** The boot is `studio-drive`'s off-screen instance; `bin/onscreen` (CGWindowList, on-screen windows only) is checked every 1.5 s and kills the instance's process group if any of its windows reaches the screen. Never point it at the owner's own Studio window, never bring a window forward, never stop another session's instance.
- **Never production.** The app talks to the local API (below) on a test account made for the run. A real person's or account's name never goes into a persona, a fixture or a display name.
- **The profile contains the app, not the tester.** The tester session cannot touch files because it has no tools for it. The profile (`writeProfile` in `run.mjs`) is for the app, whose own agent runs real programs: it refuses writes everywhere but the sandbox folder and the checkout, reads under `/Users` and `/Volumes` but those, outbound Unix sockets into other people's folders (the SSH agent, other apps), Launch Services (`open`), Apple events, and the privacy daemon. The environment is cut to a short allowlist, so no token or session id in the shell reaches the app. Run `contain-probe.mjs --inspect 9377` and `contain-routes.mjs --port <cdp port>` on a booted instance after any change to the profile: each plants canaries in the real home, tries about 25 ways to read, move, trash or open them from the app's main process and its own Files routes, checks them untouched and removes them, and prints `contained`.
- **What it does not cover:** network (the app reaches the local API and whatever its agent fetches), the checkout itself (writable, so use a throwaway worktree), and the Claude session's own context (it sees the Claude account's email, the date and the platform in its system prompt).

## The pieces

- **The build.** A detached worktree at a release tag, set up with `.claude/hooks/worktree-setup.sh`, with signing and API keys stripped from its env copies. Never the primary checkout. `make-fixture.mjs <worktree>` writes the `returning-user` scenario and its workspace fixture into it (five old chats); `new` is studio-drive's own first launch.
- **The local API.** The `internal` reference's `apps/api`, served by `pnpm api` at `http://localhost:49100` (pass `--api` to `boot`). A trial account comes from `pnpm --silent billing scenario trial --email <fixture address> --out <account file>` run from `apps/api` (sign-up refuses example.com); `set-name.mjs <account file> "<first and last name>"` gives it the persona's name, which setup greets.
- **The stand-in home.** Seeded on first boot from `scripts/homes/<scenario>/`: a few everyday files in Documents, Desktop, Downloads and Pictures, so Files is not empty.
- **The watch.** The runner ends the session when the tool server reports a rig failure, when the tester calls `finish` (after a 60 s grace), after 6 minutes with no step, or over time. `result.json` and `report.md` land in the run folder.

## Personas and scenarios

A persona is a second-person paragraph about a person, then a short list of things to do "in whatever order feels natural". The three that exist:

- `returning-user.md` (scenario `returning-user`): a person who tried an older build, given errands. It went straight at them.
- `returning-user-wandering.md` (`returning-user`): the same person, told to be curious and in no hurry, to try a control before knowing what it does and say what they expect first, to use the habits their hands already have from the apps they know, to note small surprises as stumbles, and to use the time. This is what made a run useful: twice the stumbles in the same time.
- `first-launch.md` (`new`): someone who installed it tonight on a friend's word and treats AI as a search box. Setup's sign-in is skipped for the tester (`--first-launch-account`): the tool server signs in at the model step, out of view.

Write the person's habits, not the app's features: the apps they live in, the gestures they use, what they pay for, what words they do not know. Give tasks a person would set themselves, never a feature name the screen would have to teach. Keep `prompts/system.md`'s rule that it acts like the person and not like a tester covering every button.

## Proof, then one run

`prove.sh` boots the scenario and walks it through the tester's own tool server with no model: setup (the folder step's restart included), a reply from a seeded chat, the seeded HTML page in the side pane, the large preview and Files (each painted below the fold and scrolling), and a turn of over a minute sat through with no false restart. Every check is read from outside the tester's view: the chat's records, the main process's scroll positions. `PROOFS="1 2 3"` repeats it on fresh boots. Run it after any change to the rig or the build; a failing proof means no run.

Then boot once and run once. Caps from 40 actions and 25 minutes (errands) to 90 and 50 (wandering) have worked; a run of 86 actions took 7 to 13 minutes.

## Reading a run

`runs/<name>/` has `steps.jsonl` (every action, its think-aloud, the screenshot before and after), `stumbles.jsonl` (what it chose to write down), `result.json` (actions, stumbles, cost, how it ended, rig notes by kind) and `report.md`. Read the stumbles, then the steps around each, then the reactions in passing: a person's "hm, I expected a chat box" in an action's `reaction` counts as much as a logged stumble. Then sort each against the rig limits below and `result.json`'s rig notes: what the harness caused is not the build's.

`costUsd` is what Claude Code reports for the session: an estimate at API prices. On a Claude login (no API key in the environment) it comes out of that login's usage, not a separate bill. Nearly all of it is cache reads, since every turn re-sends the whole conversation, screenshots included. The app's own agent spends separately, on the local API's upstream keys; `pnpm billing user ledger <email> --json` in the API shows each request's cost for the test account.

## Rig limits

These show up as stumbles the build does not have. Leave them out of the results and name them in one line at the end.

- **Outside the app.** Browser opens, Finder, Mail, file pickers, message boxes and system notifications never reach the screen; the guard (`lib/outside.mjs`) answers each with a plain sentence the tester reads instead (a page's file input or `alert` included). A sign-in in an outside browser cannot finish.
- **System prompts.** Privacy prompts (Reminders, for one) are refused by the profile, so a connect fails where a person would see a dialog. Move to Trash fails.
- **Main-process shortcuts.** Keys the app's menu handles (Cmd+N) arrive through the page, not the menu, so they can do nothing.
- **The profile's own marks.** The app's program sandbox is turned off so its agent can run anything inside the outer profile, which Settings › Permissions shows as a warning. The agent's in-app browser cannot open its socket. The plan page is held back.
- **Seeded data.** The trial, the account's name and its usage numbers are the test account's, and a path can say "scenario".

## The results page

Build it with the `instrument-page` skill. The format that has worked:

- The observations in the order the tester met them, logged stumbles and things said in passing alike, with no judging of which are new and no matching against anyone else's session.
- Each has a spoken name of two or three words and one matter-of-fact sentence.
- Each row reads left to right: the screen before, the screen in question, the notes. The name sits over the screen before, the sentence over the main screen.
- The main screen has circled, numbered spots, with the numbered notes beside it, never over the UI. The screen before shows a mouse pointer where the tester clicked, captioned only "The screen before" (or "The screen before, then Enter pressed" when there was no click).
- Circles, numbers and pointer are drawn into the image files, so they survive enlarging. No badges, no per-item rig notes, no "the tester clicked here".
- Rig-caused stumbles are left out and named in one line at the end.

`scripts/observations.py` draws it. For each observation, run `grid` on its screenshot and read the callout boxes off the grid in percent; write them into a spec with the page's words (kicker, title, the left-out line, footer) and run `draw`, which writes the pictures and `page.html`, rows laid out as above. Then run the instrument-page skill's `page.mjs` on it, which embeds the pictures and checks the page. The grid is there so each box comes from the picture rather than from a guess at percentages.
