# Scenarios

A scenario is one app state, named and committed, that Studio boots straight into: `studio-drive.mjs boot --scenario <name>` builds application data of its own from `<name>.yaml` and boots on it. Everything the app reads to decide its state comes from files the scenario writes, or from an environment variable where the answer comes from outside the app, so the same boot lands in the same state every time. The plan is [app-state-scenarios.md](../../docs/plans/active/app-state-scenarios.md).

```bash
node .agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs boot --purpose "setup" --scenario beta-tester
node .agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs eval "..." --scenario beta-tester
```

Pass `--scenario` to every command of the run, as with `--workspace`: it selects the instance and its port. Every boot rebuilds the scenario from scratch, so whatever a run changed is gone the next time. `--account <file>` signs the scenario in to a real Instrument account as well (the `studio-chrome-devtools` skill has the file's shape). A scenario never sets `SKIP_ONBOARDING`: setup follows from its state.

## The file

```yaml
description: What state this is, and where the app should open in it.
workspace: documents # optional: a fixture from fixtures/workspaces/ to seed in the app's own data, as earlier builds kept it; none yet otherwise
outputFolder: documents # optional: finished work in a stand-in for the folder in Documents an earlier build used
folder: placed # optional: app-data (the default), placed (a new workspace in the folder setup's first step offers, with no fixture), or move-pending (a move recorded for this launch to make)
signIns: [chatgpt] # optional: sentinel sign-ins that count as connected and fail any real request, or workers-ai, a real key from the evals' pair in packages/workspace/.env; needs a workspace, a fixture or placed
accountCheck: ready # optional: what setup's launch check of each signed-in account answers (INSTRUMENT_ACCOUNT_CHECK): ready, no-plan, out-of-usage, signed-out
notifications: not-asked # optional: what macOS says (INSTRUMENT_NOTIFICATION_STATUS)
notificationAnswer: clicked # optional: how the prompt answers (INSTRUMENT_NOTIFICATION_ANSWER): allowed, denied, or clicked, allowed with the test notification clicked
network: offline # optional: the network status (INSTRUMENT_NETWORK_STATUS)
setup: # optional: setup's record; none means setup never ran
  answered: [welcome-back, model] # the steps answered so far
  finished: true # finished, which answers every step
  addedLater: [notifications] # with finished: steps a later build added, left unanswered
```

Everything a scenario writes stays inside its own folders in studio-drive's cache, never the real home folder: `outputFolder: documents` is a folder named `Documents/Instrument Dev` (what `Documents/Instrument` is to a release build) with a few files in it, beside the scenario's application data, `folder: placed` puts the workspace in that same folder, and a move goes to an `Instrument` folder there. Setup's record goes in the workspace's machine folder (`machine/default/state.json`), where setup keeps it.

`accountCheck`, `notifications`, `notificationAnswer` and `network` take effect only in a development build. Without `accountCheck`, a sentinel sign-in's launch check is refused like any real request, so it reads as signed out. `notifications` is any status the Mac bridge answers: `not-asked`, `provisional`, `allowed`, `denied`, `unknown`, `unsupported`.

## The scenarios

| Scenario              | State                                                                                         | Setup opens on               |
| --------------------- | --------------------------------------------------------------------------------------------- | ---------------------------- |
| `new`                 | A first launch, with no workspace yet                                                         | `folder`, as Welcome         |
| `beta-tester`         | Chats in the app's own data, ChatGPT, finished work in Documents, no record                   | `welcome-back`               |
| `one-x-user`          | A 1.x task with no chat in the app's own data, ChatGPT, finished work in Documents, no record | `welcome-back`               |
| `quit-after-chatgpt`  | Picked the folder, connected ChatGPT, then quit                                               | `free-account`               |
| `folder-move-pending` | A beta tester's launch that makes the move the folder step recorded                           | `free-account`               |
| `own-key-and-account` | Picked the folder with a Workers AI key; boot with `--account` for a no-plan account          | `model`, past the plan       |
| `finished-new-step`   | Finished on a build without the notifications step                                            | `notifications`, as new only |
| `offline`             | A first launch with no network                                                                | `folder`, as Welcome         |

Check where one landed by reading `setup.live.state` over the debug port rather than by looking.
