---
name: test-studio-on-windows
description: Start, inspect, stop, and drive Instrument Studio development or installed builds on a preconfigured Windows host through SSH and loopback-only CDP. Use for Windows-specific Electron validation, remote Studio smoke tests, installed-product checks, or any request to test Studio on a Windows machine from another host.
---

# Test Studio on Windows

Use the host profile and helper rather than embedding a machine's paths, task names, or ports in prompts or repo files.

```bash
HOST=<ssh-host>
WINDOWS_HOST=.agents/skills/test-studio-on-windows/scripts/windows-studio-host.mjs
DRIVE=.agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs
```

The SSH alias must already work noninteractively. The Windows user must remain logged in because Task Scheduler launches Electron into that interactive desktop. The host must have `%USERPROFILE%\.instrument\studio-host.json`; `status` explains when it is missing.

If the profile or either scheduled task is missing, read [references/host-enrollment.md](references/host-enrollment.md) before changing the host.

## Choose the target

- Use `dev` to validate the source in the configured remote checkout. Electron Vite hot reloads renderer, preload, and main-process changes. `state`, `goto`, and `modal` work because this build exposes `window.__studioDrive`.
- Use `dev-seeded` for that same build against a disposable workspace built from a committed fixture, so what the app shows is the fixture rather than whatever that machine did last. It has its own scheduled task, CDP port, and user data directory; everything downstream works unchanged.
- Use `installed` to validate the installed packaged product. It uses the production user data and can mutate real local application state. Route helpers do not exist, so use generic `eval`, `click`, `press`, `wait`, and `shot` operations.
- The installed target validates the installed application version, not the remote checkout. The dev targets validate the remote checkout's exact Git state, not uncommitted changes on the primary machine.

## Establish source identity

Run status before every test and report the returned commit, branch, and dirty state:

```bash
node "$WINDOWS_HOST" status --host "$HOST"
```

Do not claim Windows coverage for a local diff unless that source exists on Windows. Use Git as the transfer mechanism: push a task branch or temporary validation ref from its owning machine, then fetch that exact commit on Windows. Do not let two machines write the same branch.

For the configured persistent checkout, update only when it is clean and the user intends to move it:

```powershell
$profile = Get-Content "$HOME\.instrument\studio-host.json" -Raw | ConvertFrom-Json
Set-Location $profile.repo
$env:PATH = $profile.nodeHome + ";" + $env:PATH
git pull --ff-only
git submodule update --init --recursive
& (Join-Path $profile.nodeHome "pnpm.cmd") install --frozen-lockfile
```

Record `git rev-parse HEAD` after updating. A branch name alone is not evidence of the tested source.

## Start and connect

Start waits until the expected executable owns the loopback CDP listener and the expected Studio renderer target appears:

```bash
node "$WINDOWS_HOST" start --host "$HOST" --target dev
node "$WINDOWS_HOST" start --host "$HOST" --target installed
```

The installed task must set `DISABLE_AUTO_UPDATE_POLLING=true` and pass `--remote-debugging-port=<port>` to the executable. Confirm both in `status`; do not run an installed-product test if the task omits either. A packaged app already running without CDP must be closed first because its single-instance lock prevents a second launch from adding the debug flag.

Open a foreground SSH tunnel. Choose an unused local port, especially when local Studio instances are running:

```bash
node "$WINDOWS_HOST" tunnel --host "$HOST" --target dev --local-port 49160
node "$WINDOWS_HOST" tunnel --host "$HOST" --target installed --local-port 49161
```

Keep the tunnel process alive while driving. CDP stays bound to Windows loopback and is never exposed directly to the LAN.

The tunnel command can print its forwarding message before SSH has finished binding the local port. From the driving shell, wait for this probe to succeed before calling `studio-drive`:

```bash
curl --fail --retry 10 --retry-all-errors --retry-delay 1 http://127.0.0.1:49160/json/version
```

## Start against a seeded workspace

This target needs two things, and `status` only reports the first: `devSeeded` enrolled in the host profile, and a checkout new enough to contain the seeder and the fixtures. Pointing an older checkout at it fails in the seeder rather than in the helper, so check `fixtures/workspaces/` exists at the commit `status` reports before concluding the host is misconfigured.

`start --target dev-seeded --workspace <fixture>` builds the workspace from `fixtures/workspaces/<fixture>` on the host, then starts the seeded task against it. Driving is unchanged; it is another port:

```bash
node "$WINDOWS_HOST" start --host "$HOST" --target dev-seeded --workspace documents
node "$WINDOWS_HOST" tunnel --host "$HOST" --target dev-seeded --local-port 49162
node "$DRIVE" goto /tasks/generated-pdf --port 49162
```

Seeding is idempotent, so starting the same fixture again reuses what is on disk. Pass `--fresh` to rebuild a workspace the app has written to since. Neither seeds a workspace a running instance has open: stop that target first.

`seed` does the seeding on its own, which is what to reach for when enrolling a host or working out why a fixture will not build:

```bash
node "$WINDOWS_HOST" seed --host "$HOST" --workspace documents
```

The directory holds one fixture at a time, so naming a different one rebuilds it. `status` reports which fixture is in it, and the task ids it seeded, under `devSeeded.workspace`.

A seeded workspace has no provider credentials and must not have any, so the composer reads "No models available". That is the tell that the workspace is the seeded one and not the developer's.

## Drive and collect evidence

Against a development build:

```bash
node "$DRIVE" state --port 49160
node "$DRIVE" goto /release-notes --port 49160
node "$DRIVE" click --text "New task" --port 49160
node "$DRIVE" shot /tmp/windows-dev.png --port 49160
```

Against an installed build:

```bash
node "$DRIVE" wait 'document.readyState === "complete"' --port 49161
node "$DRIVE" eval --port 49161 '({ title: document.title, readyState: document.readyState })'
node "$DRIVE" eval --port 49161 'Array.from(document.querySelectorAll("button, a, [role=button]"), (element) => element.innerText?.trim() || element.getAttribute("aria-label")).filter(Boolean)'
node "$DRIVE" click --text "<visible control from the inspection>" --port 49161
node "$DRIVE" press Escape --port 49161
node "$DRIVE" shot /tmp/windows-installed.png --port 49161
```

Do not use `state`, `goto`, or `modal` against the installed build. They wait for a dev-only handle that packaged builds intentionally omit.

A menu or popover will not open from `element.click()` in an `eval`: Radix opens on pointer events, which only `click` dispatches. When the control has no distinguishing text, mark it in one `eval` and click the mark:

```bash
node "$DRIVE" eval --port 49161 'document.querySelectorAll("button[aria-haspopup=menu]")[3].setAttribute("data-probe","kebab")'
node "$DRIVE" click --selector '[data-probe=kebab]' --port 49161
```

`click --text` only matches visible elements, so a control scrolled out of a long list reports as missing rather than being scrolled to.

Treat screenshots as supporting evidence. Also assert the expected DOM or state, inspect relevant logs, and include the remote commit or installed version in the result.

## Stop

```bash
node "$WINDOWS_HOST" stop --host "$HOST" --target dev
node "$WINDOWS_HOST" stop --host "$HOST" --target dev-seeded
node "$WINDOWS_HOST" stop --host "$HOST" --target installed
```

Stopping either dev target terminates every Studio development process whose command line belongs to the configured checkout, and stops both dev tasks: they run the same command from the same checkout, and a process does not carry which workspace it was pointed at. Do not use it when another person or agent is intentionally using that same checkout.

## Troubleshooting

- `start` reports an interactive-session failure: log into or unlock the Windows account, then retry.
- Remote CDP works but the local driver cannot connect: keep the tunnel alive and permit the Node driver to access localhost if the agent sandbox restricts network calls.
- `curl` reaches the forwarded endpoint but `studio-drive` reports no debug endpoint: the command runner is blocking Node's localhost access; rerun the driver with local-network permission.
- Dev starts with the wrong Node or pnpm: the scheduled task must prepend the configured Node installation to `PATH` and run `pnpm.cmd run dev` from `apps/studio`, bypassing the root Turbo/Corepack re-entry.
- The seeded target starts but only an onboarding window appears: its task is missing `SKIP_ONBOARDING=true`. `status` reports it as `devSeeded.validation.onboardingSkipped`.
- Seeding fails: the seeder's own message comes back on the remote command's stderr. Run `seed` alone to read it without a start timeout in the way.
- `start --target dev-seeded` reports the running instance holds another fixture: stop that target, then start it again with the fixture you want.
- Main-process hot reload loses CDP with `bind() failed: Address already in use`: stop the configured dev target and start it again.
- `status` reports a dirty checkout: identify ownership of every change before updating, switching commits, or deleting generated state.
- An external link leaves the window on the app but no browser appears: the host may have no working `http`/`https` association, which makes every `openExternal` path look broken. `Start-Process "https://example.com"` can report success and still start nothing. Run that control before blaming the app, and treat the hand-off to a browser as unverified on that host.
