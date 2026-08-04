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
  "installed": {
    "taskName": "Instrument Studio Installed Test",
    "cdpPort": 48161,
    "executable": "C:\\path\\to\\Instrument.exe"
  }
}
```

Keep this file off Git. It is the only place the helper should learn machine-specific checkout, runtime, executable, task, and port values.

## Scheduled task contract

Create both tasks for the logged-in validation user with interactive logon, limited privileges, no execution time limit, battery operation allowed, and additional instances ignored.

The development task must:

- Use `<repo>\apps\studio` as its working directory.
- Prepend `nodeHome` to `PATH`.
- Set `REMOTE_DEBUGGING_PORT` to `dev.cdpPort`.
- Run `pnpm.cmd run dev` directly from `apps\studio`; the root Turbo command can re-enter Corepack with the wrong pnpm version on Windows.
- Redirect output to a host-local log outside the checkout.

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
node .agents/skills/test-studio-on-windows/scripts/windows-studio-host.mjs status --host <ssh-host>
node .agents/skills/test-studio-on-windows/scripts/windows-studio-host.mjs start --host <ssh-host> --target dev
node .agents/skills/test-studio-on-windows/scripts/windows-studio-host.mjs start --host <ssh-host> --target installed
```

Confirm `status` reports the expected checkout SHA, both task actions, and `cdpConfigured`, `commandConfigured`, `loopback`, `ownerMatches`, `rendererReady`, `userAgentMatches`, and `workingDirectoryMatches` as `true`. The installed target must also report `updaterPollingDisabled: true`.
