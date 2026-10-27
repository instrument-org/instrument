# Beta 109 on Windows and Linux

Reviewed: snapshot at 6ce131dad (v2.0.0-beta.109), run end to end on the Windows test host and the Linux test host

An end-to-end pass of the packaged app rather than a read of the code: a fresh-identity preview build of the release commit on each host (so every launch is a first launch), plus the installed release updating itself to beta 109. Each host was driven by an agent through CDP inside the app and the desktop driver outside it, signed in to Instrument through the system browser and running on Instrument's own models. Findings are what the runs turned up; each still needs its cause confirmed in the code before a fix.

## Checked

| Check | Windows | Linux |
| --- | --- | --- |
| A. Update from the installed release | passed: beta.103 to 109, bell says it updated; "Installing…" rather than "Restarting" since 103 predates that label | passed: deb beta.102 to 109, admin password asked (D) |
| B. First launch, setup and sign-in | passed: sign-in through Chrome, Claude Haiku picked, no trial offered ("Your plan includes all of these") | passed: Google sign-in returns through the loopback callback; Auto on the trial, Haiku not offered |
| C. A working session, quit and relaunch | failed: the in-app browser is dead all first session (I); the rest passed, and the quit prompt named the running command | passed: native Python, Node, `file`; a task stopped by quit comes back failed, as it should |
| D. Background processes | passed: `kill` takes the whole process tree | passed: `kill` takes the whole process tree |
| E. Sandbox canaries | n/a | passed: `.ssh` and home writes refused, a declined folder stays closed through a symlink, nested bwrap and `xdg-open` explained |
| F. Shell regressions (drive paths, `.cmd`, `npx`, sandbox warning) | passed: `git init C:\Users\<user>\pwned` refused, `rg` refused under Documents in both spellings, `.cmd` argument with `&` intact, `npx` runs, no sandbox warning because MXC works | n/a |
| G. Folder grant through the system picker | passed | passed: portal picker from setup's folder step |
| H. Links from outside the app | passed: each build takes only its own scheme, file and new-chat links both open | partly: new-chat links work, file links do nothing (B), previews get none (E) |
| I. Notifications | passed: task-finished toast and Settings sample | passed: Settings sample and task-finished notification |
| L. Dictation | passed: granted, records and stops cleanly | n/a |
| M. Mouse thumb buttons | passed: real back and forward buttons move between tabs | n/a |

## Findings

### A. Quitting by signal with work running never quits or tears down

- Status: fixed
- Where: [create-workspace-actor.ts:352](/apps/studio/src/electron-main/lib/create-workspace-actor.ts#L352)
- What: on Linux, SIGTERM (what a logout or shutdown sends) reaches `before-quit`, and the packaged build's quit approval opens the "Quit with work running?" dialog, which nobody answers. Both stops with a job running were SIGKILLed after the 10 s grace with no `Quit teardown` line, so tasks were not stopped with a record and teardown never ran. An idle stop tears down and exits in 2 s. A quit no one asked for in the app should skip the prompt.

### B. An `instrument://file/` link does nothing on Linux

- Status: open
- Where: [outside-links.ts:110](/apps/studio/src/electron-main/lib/outside-links.ts#L110) (a guess: the `openFile` path from here to the window's `openFile` handler)
- What: with the installed app running, `gio open instrument://file/~/e2e-b109/stats.py` (an existing file, folder never refused) opened no tab, toast or window and logged nothing, while a new-chat link in the same session landed in the composer.

### C. Closing the only tab quits the app on Linux

- Status: not a defect
- Where: [index.ts:450](/apps/studio/src/electron-main/index.ts#L450)
- What: closing the last tab (a "Not found" tab here) closed the window, and `window-all-closed` quit the app without asking. Whether closing the last tab should close the window at all is the question.
- Note: Chrome on Windows and Linux does the same: closing the last tab closes the window, and the browser exits with no windows left. The app follows the browser it looks like.

### D. A deb update asks for an administrator password with the app gone from the screen

- Status: open
- What: "Install now" runs `pkexec dpkg -i`, so for over a minute the only thing on screen was polkit's password dialog, with no app window and no "Restarting" state. Someone who cancels or doesn't know the password gets no word from the app. The relaunched app came back up outside the test host's service, which may only matter to the test tooling.

### E. Preview builds receive no `instrument://` links on Linux

- Status: not a defect
- Where: [index.ts:123](/apps/studio/src/electron-main/index.ts#L123)
- What: an unpacked preview has no `.desktop` file, so `setAsDefaultProtocolClient` registers nothing and links go to the installed app. Likely acceptable for previews; it means link checks on Linux need the installed build.
- Note: an unpacked preview has no desktop entry to register a scheme through; link checks on Linux use the installed build.

### F. The agent can't read a local HTML page through its browser tab

- Status: not a defect
- What: `instrument tab open` on a local `report.html` opened it as a file tab, and `instrument tab read` answered that it "is not a page". For `https://example.com` the agent opened a tab but read the page with curl and `web_fetch` instead.
- Note: a path given to `instrument tab open` opens the file's own viewer, not a page, and `tab read` on it says so and points at reading it by its path, which the agent can since it named that path; `agent-browser open <path>` is the way to the rendered page. The `example.com` half is very likely finding I: on a first session no guest attaches, so the tab never had a page to read and the agent fell back to fetching it.

### G. A `&` inside `bash -c` in a background command never ran (low confidence)

- Status: fixed
- What: `bash -c 'sh -c "sleep 900" & python3 … & while true; do date >> bg.log; sleep 5; done'` showed as running in `jobs`, but `bg.log` was never created on the host. Possibly the just-bash `bash -c` running the inner `&` in the foreground. Not reproduced.
- Note: reproduced on macOS with `run-bash`. A bare `bash -c` or `sh -c` is just-bash's own interpreter, which parses `&` and runs the statement in the foreground like any other, so `sh -c "sleep 900"` held the loop for 15 minutes. `/bin/bash -c` is the computer's bash and backgrounds as expected. The bash tool already refused a non-trailing `&` at the top of a call, but did not look inside a script handed to `bash -c`, `sh -c` or `eval`; it now refuses an `&` there too ([background-ampersand.ts](/packages/workspace/src/lib/background-ampersand.ts)).

### H. The ChatGPT account store can't be read on Linux

- Status: declined
- What: every launch after sign-in logged `(chatgpt-account) Failed to read the ChatGPT account store Error: Encryption is not available` four times. No visible effect in this run, and Instrument sign-in survived restarts; a ChatGPT sign-in on Linux was not tried.
- Declined because: Linux without a usable keyring has no encryption for Electron's `safeStorage`, which every Electron app meets the same way; the line is noise with no effect seen.

### I. The in-app browser is dead for the whole first session after setup

- Status: fixed
- Where: [app-window.ts:303](/apps/studio/src/electron-main/windows/app-window.ts#L303), [create-workspace-actor.ts:113](/apps/studio/src/electron-main/lib/create-workspace-actor.ts#L113)
- What: on a first launch the app window opens during setup, before any workspace exists, so `getBrowserViewManager()` is still undefined when the window binds itself as the browser's host. The manager is created later with the workspace and never binds the window already open, so no guest ever attaches: the Browser rail hangs on "Opening browser…" and `agent-browser open` fails after about 15 s with "The browser did not open a page". Quitting and relaunching fixes it. Seen on Windows; nothing in the path is platform-specific, and finding F on Linux may be the same thing.
- Note: [cdp-task-bridge.ts:375](/packages/workspace/src/logic/server/routes/cdp-task-bridge.ts#L375) drops the `createTarget` error without logging it, so main.log had nothing for the agent's attempts.
- Note: the browser manager is the app's, made by whichever of the window and the workspace asks for it first, so the order setup opens them in doesn't matter. A workspace switch or move relaunches the app, so it never met this.

### J. The sign-in callback leaves its token in the browser's address bar and history

- Status: open
- What: after Google sign-in, Chrome on Windows keeps `127.0.0.1:<port>/auth/callback/instrument?state=…&token=…` in its address bar and history. First seen on 10-12 in Brave and still there.

### K. Setup's model step repeats the provider's name

- Status: declined
- What: "Pick your main model" shows "Claude  Claude Haiku".
- Declined because: the model picker shows provider then model ("Claude", "Claude Haiku") by design.

### L. A preview's version pill says "prod"

- Status: open
- What: the pill reads "prod 2.0.0-beta.109" beside the "Preview · b109-131" chip.

### M. Windows toasts carry Electron's default app identity

- Status: open
- What: toasts register as `electron.app.Instrument` and `electron.app.Instrument Preview (<name>)`. A guess, not checked: the app never calls `app.setAppUserModelId`.

## Not covered

- Files on Windows (This PC, network share, exFAT), visible chat folders, crash report and shutdown, Controlled Folder Access: left out of this pass's scope.
- No trial was offered on either host to the test account, so the trial step went unseen.
- Linux: Haiku 5.5 was not offered among Instrument's models, so the run used Auto. Desktop screenshots failed through the desktop driver, so outside-app checks there rest on accessibility trees.
- Linux has a virtio GPU only, so nothing GPU-related was exercised there.
