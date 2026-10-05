# Plan: the user chooses where Instrument keeps files

Status: agreed, not started. Tracked in Linear FP-1351. Until it lands, the location stays `~/Documents/Instrument`, unchosen.

Instrument keeps what it makes in one folder every chat reaches, mounted as `Instrument`. Today that folder is `~/Documents/Instrument`, created without asking. On a fresh macOS install the first touch raises the system's "access files in your Documents folder" prompt, and since the app window loads behind onboarding, that prompt lands on the first onboarding screen before anything has said why. The folder-icon step then waits behind the prompt and times out after 5 seconds. A preview build (Actions › Preview Build) shows all of this, because its first launch is a real one.

## What ships

- **An onboarding step, blocking, that asks where Instrument keeps files.** It opens the system panel (`dialog.showSaveDialog`, opened at Documents with "Instrument" prefilled), so the user's choice is the consent: macOS raises no separate prompt for a folder picked in its own panel, and the consent covers only that folder, which is why the panel picks the folder itself rather than its parent. The folder is created from the panel's result, inside the step.
- **`~/Instrument` as the fallback.** It sits outside the folders macOS guards, so it never prompts. There is no API that says whether Files & Folders access was granted, so the fallback is triggered by an EPERM on a real write, not by a check up front.
- **One setting for the location.** `outputFolderPath()` (`packages/workspace/src/lib/chat/output-folder.ts`) and Studio's literals (`INSTRUMENT_FOLDER` in `shared/computer-href.ts`, `isWorkspaceFolder` in `client/lib/path-utils.ts`, `output-folder-icon.ts`, the delete-chat dialog copy, the eval sandbox home) all read it.
- **Nothing touches the folder before the step.** `workspace.window.ensure` stops creating the folder and setting its icon while onboarding is still on screen.
- **Settings shows the location**, with Show in Finder. Read-only at first.
- **Existing workspaces keep `~/Documents/Instrument`**, recorded as their chosen location by a settings migration, so no one's files move.
- Windows and Linux take the same step, or the default, since neither has a prompt to avoid.

## Changing the location later

Not in the first cut. Every chat recomputes its standing `Instrument` mount on every read (`folder-reach.ts`), so pointing the setting elsewhere silently moves every old chat's `Instrument` to a folder its history never wrote to, while a task that was handed the folder keeps the old absolute path on its record. A real change is one of two pieces of work: move the files and rewrite the records that hold the old path, or apply the change to new chats only and pin existing ones to the old path.

## Things to know while building it

- The consent lives on the folder (`com.apple.macl` xattr). It survives reinstalls, never shows in System Settings, and `tccutil` does not clear it, so Preview › Reset to First Run does not either. Testing the denied path again needs a folder that has never been picked.
- With Desktop & Documents in iCloud on, files in Documents may sync, which is part of why `~/Instrument` is offered.
- The Mac native bridge (`docs/architecture/mac-native-bridge.md`) needs no change: its helper has no bundle id of its own, so macOS attributes its prompts to Instrument, and it never reads files.

## Done when

- A fresh install shows no Documents prompt before the user picks a folder, and the step decides the location.
- Settings shows the location.
- First run reports no exception from the folder-icon step.
