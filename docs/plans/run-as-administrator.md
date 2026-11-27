# Plan: the agent asks to run a command as administrator

Status: open. Built on macOS and Windows, checked with unit tests, evals and the running app with a stand-in for the system's prompt. Left: a run through the real macOS password prompt and Windows' User Account Control (below), and the gaps under Open.

A change only an administrator can make (the time zone, Remote Login, installing for every user) used to end with the agent trying `sudo`, being refused by the sandbox, and writing the steps out by hand. The agent now asks once, the person sees the exact command on a card, and the system's own prompt does the rest.

## How it works

- **The call.** `bash` takes `admin: true` and a one-line `reason`. It runs nothing: it records a permission ask with `on: "admin"` and the command as its `target` (`src/tools/bash.ts`), and the turn ends as for any other ask. Refused before any card: `sudo` in the command, no reason, more than `ADMIN_COMMAND_MAX_CHARS`, Linux, a chat no card can show in, and the same command asked again after a no since the person last typed (`adminRefusedSinceTyped`).
- **The card.** Over the reply box: the reason, the command in a scrolling well with Copy, then Run as administrator and Don't allow. There is no Always allow: an admin ask runs at most once. On another computer the card names the computer it runs on and offers only Don't allow (`permission-asks.tsx`).
- **The run.** Only the ask's own computer acts (`drive-asks.ts`). A yes from that computer moves the ask to the `admin-prompt` system wait and calls `runAsAdmin` (`src/lib/permissions/run-as-admin.ts`); a yes written by another device is refused, and a no from any device is taken (`askStates`).
  - macOS: `osascript` with `do shell script … with administrator privileges` and a fixed prompt text. The command arrives as an argument and is quoted with AppleScript's `quoted form of`, so no character of it is read as script. Cancel is error -128.
  - Windows: `Start-Process -Verb RunAs` on an encoded PowerShell script that runs the command as a script block from a single-quoted literal and writes its output to a temp file. Cancel is error 1223.
- **The answer.** The outcome is on the answer note's `run` field: ran (exit code and output, head and tail kept), canceled (counted as a no), failed, or unknown when the app quit while the prompt was up. The agent reads `adminAnswerText`; the chat shows a row, "Ran as administrator: …" or "Not allowed: …", that opens to the command and output.
- **The fallback.** After a no, the agent links the settings pane its system information names (`adminSettingsGuidance`, `ADMIN_NOT_ALLOWED`).
- **Evals and tests** never reach the system: `setAdminRunner` puts a stand-in in its place, and the eval harness installs one for every run and answers the card through the permissions route as a case's `adminAnswer` says.

## Manual check

- **Mac:** ask "put my mac on mountain time". Run as administrator, enter the password: the row reads Ran and the time zone changed. Ask to set it back, then Cancel in the system prompt: the row reads Not allowed and nothing changed. Ask once more and press Don't allow: Not allowed, then a Date & Time link.
- **Windows:** the same request. Yes in User Account Control: Ran, with output. Again with No: Not allowed.

## Open

- Whether macOS's prompt names `osascript` rather than the app, and how its fixed text reads beside the system's own line.
- A build from before this does not know `on: "admin"` in an ask record; how it shows a chat with one open is unchecked.
- A root command that never exits keeps the ask waiting until the app quits; there is no timeout.
- The other-computer card is checked only in unit tests.
