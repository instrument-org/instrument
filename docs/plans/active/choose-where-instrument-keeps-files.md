# Plan: the user chooses where Instrument keeps files

Status: agreed, the step not started. Tracked in Linear FP-1351. The unchosen location has moved to `~/Instrument` ahead of the step, so the prompt below is out of the way of a first launch; an install that already made `~/Documents/Instrument` keeps using it.

Instrument keeps what it makes in one folder every chat reaches, mounted as `Instrument`. That folder was `~/Documents/Instrument`, created without asking. On a fresh macOS install the first touch raised the system's "access files in your Documents folder" prompt, and since the app window loads behind onboarding, that prompt landed on the first onboarding screen before anything had said why. The folder-icon step then waited behind the prompt and timed out after 5 seconds. A preview build (Actions › Preview Build) showed all of this, because its first launch is a real one. The home folder is guarded by nothing, which is why the unchosen location is there now; what is still to build is the person choosing it.

## What ships

- **An onboarding step, blocking, that asks where Instrument keeps files.** It opens the system panel (`dialog.showSaveDialog`, opened at Documents with "Instrument" prefilled), so the user's choice is the consent: macOS raises no separate prompt for a folder picked in its own panel, and the consent covers only that folder, which is why the panel picks the folder itself rather than its parent. The folder is created from the panel's result, inside the step.
- **`~/Instrument` as the fallback.** It sits outside the folders macOS guards, so it never prompts. There is no API that says whether Files & Folders access was granted, so the fallback is triggered by an EPERM on a real write, not by a check up front.
- **The location is the workspace's.** The step moves the workspace to the folder picked (or opens the one already there) through the routes Settings › Storage uses, and the folder is then where finished work goes too (`outputFolderPath()`); it keeps no setting of its own. What it calls and what each answers: [workspace-layout.md](workspace-layout.md), "The onboarding folder step".
- **Nothing touches the folder before the step.** `workspace.window.ensure` stops creating the folder and setting its icon while onboarding is still on screen.
- **Settings shows the location**, with Show in Finder. Read-only at first.
- **Existing workspaces keep `~/Documents/Instrument`**, so no one's files move. Already true: the app answers with that folder for a computer that has a workspace of its own and that folder on disk.
- Windows and Linux take the same step, or the default, since neither has a prompt to avoid.

## Where the step lives

The folder step belongs to the onboarding screens rather than beside them: the screen it sits on is the one that explains what Instrument keeps and where, and getting past it is what says the person agreed to the location. So it lands with that larger onboarding flow, and the two are built together rather than one waiting on the other.

Two things can ship before it, and are worth shipping before it, since they are what a tester and a first launch run into:

- **The unchosen location moves to `~/Instrument`.** Done. Nothing macOS guards is touched, so a first launch raises no prompt at all, and the folder a person is told about is the one they can see in their home folder. An install that already made `~/Documents/Instrument` keeps it (`unchosenOutputFolder`), which is decided from the app's own data rather than by looking inside Documents, since looking is the thing a first launch must not do.
- **Settings shows the location**, read-only, so a tester can see which folder an install settled on without reading the registry.

## Taking the pick while an upgrade is still running

A first install has nothing to bring over: the settings migration, the machine-data move and the layout sweeps all run at the first launch and find nothing, so the step can take a folder as soon as it is picked. An install that upgraded is the case to design for, and only an install with chats from 1.x or an early beta is one.

The order the app keeps: a first launch makes no workspace until setup's first step places it where the person picks, with no restart; a workspace an earlier build kept in the app's own data (`<userData>/workspace`) runs its sweeps there, and a pick for it is recorded in the registry entry and made by the next launch before any store opens. The step needs nothing of its own for that; `workspaces.current`, `workspaces.checkFolder` and `workspaces.move` are what it calls.

Two things to build the step against:

- **The sweeps run only while the workspace is in the app's own data**, since a folder the person picked was never one of those (`create-workspace-actor.ts`). A move that happened before they ran would leave them skipped for good, so a recorded move waits for the launch that finishes them and is made by the one after (`finishPendingMove`). The step may therefore take a pick at any point; what it must not do is wait for the move itself before letting the person on.
- **Settings' refusal is not the step's refusal.** Settings › Storage refuses a pick while the workspace is unsettled and says to quit and reopen, which inside onboarding is a dead end. The step either waits for the sweeps with a line about what is happening, or takes the pick and leaves the move to the restart that ends onboarding.

Measured 2026-10-24 on one real upgrade: converting 396 chats took 5.1 s, and writing their chat folders another 0.4 s. It runs before the pick either way, and only an install that upgraded pays it.

## When the folder is not there, or cannot be read

The location is a folder on someone's disk, so every way a folder goes wrong is a state the app has to have an answer for. What each one does today:

| What happened | What the person gets | Built |
|---|---|---|
| The folder cannot be read (the grant was taken back, or macOS refused it) | The refusal window, before anything else opens: pick the folder again, which is also how macOS gives access back, or start over with a new one | yes |
| The folder is gone (deleted, or moved away by hand) | The same window. The entry keeps the folder it was given rather than quietly opening another one | yes |
| The folder was made by a newer build | The same window, offering to update, which runs the updater with no workspace open | yes |
| A folder inside it is gone (`Chats/`, `Drafts/`, `Topics/`, ...) | A notice in the bell naming which, saying nothing is lost, and the list says the folder is gone rather than offering to start a chat | yes |
| The folder was moved by hand and the person points the app at it again | It is recognized as the same workspace and keeps its rules, topics and drafts; the window's tabs and the recent files do not follow | partly |
| The person declines the panel, or picks a folder that cannot be written | The fallback, `~/Instrument`, decided by a failed write rather than by a check up front | no |
| A write fails later (the disk filled, the volume was unplugged, the folder went read-only) | Nothing of its own: the failure surfaces wherever it happened | no |

The last two are what this plan still owes. The last one matters most for a folder on a network or external volume, which is exactly the kind of folder someone picks on purpose.

## Changing the location later

Settings › Storage moves the Instrument folder: the app restarts and moves it before anything opens, and a path stored into the old place is written where it went. Finished work the old output folder holds stays where it is.

Picking a folder works the way it does in Obsidian: the person picks it and it is used. Only a folder the app would break in is refused: the home folder itself, the app's own files, and a folder in or around another Instrument folder. Anywhere riskier (Documents itself, a temporary or sign-in folder, a system folder, the apps' data, a disk's top) is a warning the person can go past. For the home folder, a folder around it, and Documents, Desktop or Downloads themselves, the main choice is a new `Instrument` folder inside (`~/Instrument`, `~/Documents/Instrument`), made when it is not there yet, and the dialog says when that folder already has files or is already an Instrument folder. The onboarding step offers the same.

## Things to know while building it

- The consent lives on the folder (`com.apple.macl` xattr). It survives reinstalls, never shows in System Settings, and `tccutil` does not clear it. Testing the denied path again needs a folder that has never been picked.
- With Desktop & Documents in iCloud on, files in Documents may sync, which is part of why `~/Instrument` is offered.
- The Mac native bridge (`docs/architecture/mac-native-bridge.md`) needs no change: its helper has no bundle id of its own, so macOS attributes its prompts to Instrument, and it never reads files.

## Done when

- A fresh install shows no Documents prompt before the user picks a folder, and the step decides the location.
- Settings shows the location.
- First run reports no exception from the folder-icon step.
- Every row in the table above says yes, or says why it never will.
