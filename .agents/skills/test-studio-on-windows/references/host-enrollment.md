# Windows host enrollment

Use this only when `windows-studio-host.mjs status` reports a missing profile or scheduled task. Host enrollment changes persistent machine state, so inspect the host first and keep all debugging endpoints on loopback.

## Host profile

Create `%USERPROFILE%\.instrument\studio-host.json` on Windows with host-local values:

```json
{
  "schemaVersion": 1,
  "repo": "C:\\path\\to\\instrument",
  "nodeHome": "C:\\path\\to\\node-installation",
  "dev": {
    "taskName": "Instrument Studio Dev",
    "cdpPort": 48160
  },
  "devSeeded": {
    "taskName": "Instrument Studio Dev Seeded",
    "cdpPort": 48162,
    "userDataDir": "C:\\path\\to\\localappdata\\instrument-seeded\\active"
  },
  "installed": {
    "taskName": "Instrument Studio Installed Test",
    "cdpPort": 48161,
    "executable": "C:\\path\\to\\Instrument.exe"
  }
}
```

Keep this file off Git. It is the only place the helper should learn machine-specific checkout, runtime, executable, task, and port values. Each target needs its own CDP port and its own task name; the helper refuses a profile that shares either.

`devSeeded` is optional. Without it the other two targets work and `status` reports the seeded one as unconfigured. Its `userDataDir` is a directory the seeder owns outright: under `LOCALAPPDATA`, never inside the checkout, and never a real application data directory. It holds one fixture at a time, and the helper rebuilds it when asked for another, so nothing there is worth keeping.

## Scheduled task contract

Create each task for the logged-in validation user with interactive logon, limited privileges, no execution time limit, battery operation allowed, and additional instances ignored.

The development task must:

- Use `<repo>\apps\studio` as its working directory.
- Prepend `nodeHome` to `PATH`.
- Set `REMOTE_DEBUGGING_PORT` to `dev.cdpPort`.
- Run `pnpm.cmd run dev` directly from `apps\studio`; the root Turbo command can re-enter Corepack with the wrong pnpm version on Windows.
- Redirect output to a host-local log outside the checkout.

The seeded development task is that same task with two additions, and is what makes a seeded run possible: the task environment is fixed at enrollment, so there is nowhere for a per-start variable to go. It must:

- Meet everything above, with `REMOTE_DEBUGGING_PORT` set to `devSeeded.cdpPort` instead.
- Set `ELECTRON_USER_DATA_DIR` to `devSeeded.userDataDir`.
- Set `SKIP_ONBOARDING` to `true`. A seeded workspace has no provider credentials and must not have any, so without it the app opens the onboarding window and never reveals the main one, which reads as a hang.
- Redirect output to a different log than the development task, so a run against a seeded workspace is separable from a plain one.

The installed task must:

- Use the executable's directory as its working directory.
- Set `DISABLE_AUTO_UPDATE_POLLING=true`.
- Launch the configured executable with `--remote-debugging-port=<installed.cdpPort>`.
- Redirect output to a host-local log outside the checkout.

Do not add firewall rules for either CDP port. The app must listen only on `127.0.0.1`; connect through SSH forwarding.

Noninteractive SSH does not initialize `fnm`. Prepend `nodeHome` to `PATH` before invoking `pnpm.cmd` manually as well as inside the development task.

## Validation

Run these from the controlling machine after enrollment:

```bash
HOST_HELPER=.agents/skills/test-studio-on-windows/scripts/windows-studio-host.mjs
node "$HOST_HELPER" status --host <ssh-host>
node "$HOST_HELPER" seed --host <ssh-host> --workspace documents
node "$HOST_HELPER" start --host <ssh-host> --target dev
node "$HOST_HELPER" start --host <ssh-host> --target dev-seeded --workspace documents
node "$HOST_HELPER" start --host <ssh-host> --target installed
```

Confirm `status` reports the expected checkout SHA, every task action, and `cdpConfigured`, `commandConfigured`, `loopback`, `ownerMatches`, `rendererReady`, `userAgentMatches`, and `workingDirectoryMatches` as `true`. The installed target must also report `updaterPollingDisabled: true`, and the seeded target `onboardingSkipped: true` and `seededWorkspaceConfigured: true`.

`seed` before the first seeded start: it fails on its own if the checkout cannot build a workspace, which is a clearer failure than a start that times out waiting for a window.
