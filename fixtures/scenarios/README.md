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
workspace: documents # optional: a fixture from fixtures/workspaces/ to seed; none yet otherwise
outputFolder: documents # optional: finished work in a stand-in for the folder in Documents an earlier build used
folder: move-pending # optional: app-data (the default), or a move recorded for this launch to make
signIns: [chatgpt] # optional: sentinel sign-ins that count as connected and fail any real request
notifications: not-asked # optional: what macOS says (INSTRUMENT_NOTIFICATION_STATUS)
notificationAnswer: clicked # optional: how the prompt answers (INSTRUMENT_NOTIFICATION_ANSWER): allowed, denied, or clicked, allowed with the test notification clicked
network: offline # optional: the network status (INSTRUMENT_NETWORK_STATUS)
setup: # optional: setup's record; none means setup never ran
  answered: [welcome-back, model] # the steps answered so far
  finished: true # finished, which answers every step
  addedLater: [notifications] # with finished: steps a later build added, left unanswered
```

Everything a scenario writes stays inside its own folders in studio-drive's cache, never the real home folder: `outputFolder: documents` is a folder named `Documents/Instrument` beside the scenario's application data, and a move goes to an `Instrument` folder there.

`notifications`, `notificationAnswer` and `network` take effect only in a development build. `notifications` is any status the Mac bridge answers: `not-asked`, `provisional`, `allowed`, `denied`, `unknown`, `unsupported`.

## The scenarios

| Scenario              | State                                                                       | Setup opens on               |
| --------------------- | --------------------------------------------------------------------------- | ---------------------------- |
| `new`                 | A first launch                                                              | `way-in`                     |
| `beta-tester`         | Chats in the app's own data, ChatGPT, finished work in Documents, no record | `welcome-back`               |
| `quit-after-chatgpt`  | Connected ChatGPT, then quit                                                | `free-account`               |
| `folder-move-pending` | The launch that makes the move the folder step recorded                     | `notifications`              |
| `finished-new-step`   | Finished on a build without the notifications step                          | `notifications`, as new only |
| `offline`             | A first launch with no network                                              | `way-in`                     |

Check where one landed by reading `setup.live.state` over the debug port rather than by looking.
