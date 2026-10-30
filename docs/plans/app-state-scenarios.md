# Plan: app-state scenarios

Status: open. Started. `studio-drive.mjs boot --scenario` and setup's scenarios (`fixtures/scenarios/`) are built, with the setup record, sentinel ChatGPT sign-ins, the folder's place and `--account`; the account states through the local API (step 2's account half) and the contact sheet (step 4) are not.

## Problem

More and more of what Studio does depends on a state that takes work to reach: a trial about to end, a used-up usage window, a revoked account, onboarding finished with two accounts already signed in, the provider picker opened from Settings once a plan exists. Today each of those means signing in, spending, and clicking through by hand. So some states get checked rarely and others never, and an agent checking a change has no repeatable way to land in one either.

A scenario is a named, committed description of one such state: a disposable workspace, an account in a known billing state, and the screen to open. Booting a scenario lands the app on that screen, the same way every time. Agents boot and maintain scenarios: a person asks for one by name, and the agent boots it on its own instance.

## What already exists

| Piece | Where | What it gives a scenario |
| --- | --- | --- |
| Seeded workspaces | `fixtures/workspaces/`, `pnpm workspace:seed` | Chats, tasks, files, folders, preferences, feature flags, in a userData directory of their own |
| `studio-drive.mjs boot --workspace <fixture>` | `studio-chrome-devtools` skill | Boots Studio on that directory and port, with `SKIP_ONBOARDING` |
| `pnpm billing dev-session --email E` | platform API (agent-reference `internal`), `apps/api` | Creates or reuses a user in the local API's database and prints a bearer token, with no Google sign-in. Refuses every target but `local` |
| `billing.dev.setDevToken` | `electron-main/rpc/routes/billing.ts` | Signs Studio in with that token. Only for a dev build pointed at a local API |
| Operator verbs | `pnpm billing user ...`, `assign` | `end-trial`, `restart-trial`, `grant`, `reset-window`, `restore-access`, and plan or policy overrides, all audited |
| `billing.dev.burn` | `electron-main/rpc/routes/billing.ts` | Spends a set amount through the local API's stub upstream, so a window can be filled without a model |
| Subscriptions on Stripe test clocks | `pnpm billing e2e --clocks` | Real subscription lifecycles, including failed payments |
| `apps/studio/scripts/billing-e2e.ts` | this repo | Already chains all of the above against a real Studio, so the mechanics are proven |

The account half is solved on the server already. A scenario answers "which account state", and the local API and its operator verbs supply it. Nothing in Studio fakes a server answer: the app reads the same `billing.offer`, `billing.status`, and refusals it reads in production.

## The shape

One YAML file per scenario under `fixtures/scenarios/`:

```yaml
description: Trial ends tomorrow, ChatGPT and Claude already signed in, adding a provider from Settings.
workspace: documents            # optional; an empty workspace otherwise
account:                        # optional; signed out otherwise
  trial: ends-in-1d             # or: active, ended
  plan: lower                   # assign, through the operator CLI
  window: { key: 5h, used: 0.95 }
  revoked: false
setup:                          # setup's record: finishing answers every step
  finished: true
signIns: [chatgpt]              # inert records, no real tokens
open: /settings?section=providers&add=1
```

`studio-drive.mjs boot --scenario <name>` does it in order:

1. Seed the workspace (the existing seeder) into a directory keyed by scenario.
2. If `account` is set: check the local API is up at `MAIN_VITE_APP_API_BASE_URL`, mint a session for an email derived from the scenario name (`scenario-<name>@…`, so reruns reuse one user), and apply the account state through the operator verbs and `burn`. Each step is idempotent, or resets first.
3. Boot Studio on that directory, call `setDevToken`, and navigate to `open`.

Scenarios that need no account (onboarding, signed-out states, layout) run without the local API, so most of the catalog stays cheap.

## Steps

1. **Workspace stores in the manifest.** Let a scenario write setup's record (`setup` in machine state), provider configs, and app connections. Sign-in records hold sentinel tokens that pass validation and fail any real call.
2. **`--scenario` in studio-drive**, with the account steps above. Start with six scenarios: signed out, trial available, trial ending, window used up, payment owed, access revoked.
3. **Screens you can link to.** Each scenario's `open` should be a URL. Where the screen it needs is held in component state (a Settings section, an onboarding step, the add-provider dialog), move it into a search param. One at a time, only as a scenario needs it; no general UI-state serializer.
4. **A contact sheet.** It boots every scenario, captures its `open` screen, and writes one page of captures. It runs locally first, and in CI once the seeded-workspaces CI step lands ([seeded-test-workspaces.md](seeded-test-workspaces.md)).

## Open questions

- **A subscribed or payment-owed state without Stripe.** The operator verbs can't put a user straight onto a paid plan or into a failed payment; today that takes Checkout or test clocks, which is slow for a scenario. A local-only operator verb that writes the subscription mirror directly (refusing every target but `local`, like `dev-session`) would make these scenarios take seconds. That belongs in the platform API.
- **Mid-chat refusals.** A used-up window shows up when a chat is sent. `burn` fills the window, but seeing the notice in a transcript needs a turn to be refused. Either the scenario sends one message through the stub upstream, or the workspace fixture carries a recorded refused turn. Prefer the recorded turn: it needs no model and no network.
- **Third-party account sign-ins** that the screen asks about live (a ChatGPT plan check, say) will fail with sentinel tokens. Find out which screens do that before step 1 and decide per screen.

## Out of scope

- Real Checkout and portal runs. `billing-e2e.ts` owns those.
- Faking the platform API in Studio. The local API is the source of every account state.
- Pixel assertions. The contact sheet is for looking at, not for diffing.
