# Plan: the onboarding setup assistant

Status: open. Building. The four streams under [Building it](#building-it) are in (the facts and record in `setup-facts.ts`, the window held by `setup-state.ts`, the shared sign-in with `checkAccount` and `ConnectOutcome`, the offline pill), every step in `SETUP_STEPS` has a page under `components/setup/steps/`, and `studio-drive.mjs boot --scenario` boots the setup states; the pages are still being brought to the designs, and the manual pass against real accounts is open. The designs are in Figma (Instrument 2.0 file, page R6, node 4238-2276), the source of truth for every screen and its copy. Where Figma has no frame (Grok, out of usage during setup, the beta folder move, Welcome back's place, card and intro trials, the beta offer, the test notification's click, a step added by an update), the wireframes fill in until the design does. Tracked in Linear FP-1356 (design) and FP-1368 (testing against real accounts).

Onboarding is what a person goes through from first launch to an app that works: a way to get AI (an Instrument plan, a ChatGPT, Claude or Grok plan, or their own API key), the main model, the workspace folder, notifications, and the look.

## Where setup opens: facts, plus the steps answered

Setup never saves which page it was on. At launch, and whenever a fact changes, main reads a few facts and the list of steps answered, and the current step is the first step that is needed and not done. Pages inside a step (a sign-in waiting, an account check's answer, Trial started) live only in the renderer, so a quit lands back at the start of that step.

The facts (`SetupFacts`, `shared/setup.ts`):

| Fact | Read from |
|---|---|
| Usable AI | `getAllAIProviderConfigs()`, with each ChatGPT, Claude and Grok account checked again (`checkAccount`): an account the check calls ready or out of usage counts, one with no paid plan does not. Claude's status is waited on with a deadline, so a Claude-only person never flashes as new. |
| Instrument account | `hasToken()`, then `billing.status` for whether it has a plan or a running trial |
| Has chats | the workspace has chats (`workspaceHasChats()`); the folder step's move copy keys on it |
| Tested before | a chat in the workspace was started by a 2.0 beta (its own session's log header names the build) or came from 1.x or a `chat.db` (`workspaceTestedBefore()`); Welcome back keys on it |
| Has a workspace | the launch opened one; false only when there was none to open (`needsPlacing`), until the folder step places it |
| Folder settled | `workspaces.folder()` is outside app data, pinned, or has a move recorded and waiting on a restart |
| Notifications | `mac.notifications.status`; `unknown` and `unsupported` count as done, so the step can't trap |

The record (`SetupRecord`, the workspace's state in its machine folder, keyed by the local id the launch resolves, so it is there before the folder is picked): the time each answered step was answered, and when setup finished. The first workspace a launch opens with a folder, unless pinned, takes in the record earlier builds kept once for the whole computer, which is then removed. It replaces `onboardingVersion` and `hasCompletedProviderSetup`, and nothing else writes either.

The steps, in order (`SETUP_STEPS`):

| Step | Needed while | Done by |
|---|---|---|
| `welcome-back` | tested before, and setup never finished | answering it |
| `folder` | no workspace, or the folder isn't settled | the fact, and answering it; placing a first launch's workspace answers Welcome back too |
| `choose-ai` | no usable AI, or an Instrument account with no subscription, no running trial and no AI of its own | the fact, or answering it once a way in is ready |
| `free-account` | usable AI and no Instrument account | answering it (Google or Not now) |
| `model` | always | answering it |
| `notifications` | status is `not-asked` or `provisional` | the fact, or answering it (Not now) |
| `look` | always | answering it |

With no workspace, the folder step is the only one, whatever the record says: nothing else can run until it places one. On a first launch it is Welcome with the folder (Documents suggested, the macOS prompt explained under it); Continue makes the folder there or opens the Instrument folder already in it, registers it under the local id the window's session already uses, starts the workspace in the same process, and loads the window again on the way in. The way in follows with no Back to the folder, since changing it then would be a move.

Two rules keep this from trapping or nagging anyone:

- **Before finishing, facts and answers both count. After finishing, only a missing answer brings setup back.** Signing out of every AI later, or a folder moved back into app data, never reopens setup; the app's own notes handle those. A step added by an update has no answer for anyone, so people who finished see only that step, under "One new thing to set up".
- **Steps a person can't do here are skipped, not shown.** Notifications need macOS.

`SKIP_ONBOARDING=true` hides setup without writing anything, for fixtures and smoke tests. It skips the step where the workspace is chosen, so it needs `INSTRUMENT_WORKSPACE` naming one, and the launch refuses to start without it.

Welcome back is how a beta tester is found: the API has no beta flag, and its beta offer only means "account made before a cutoff, never subscribed". Their workspace is in app data with chats in it, and their finished work went to `~/Documents/Instrument`. The folder step, right after Welcome back, asks them too, and Continue moves the chats there and restarts the app; the move is recorded before the restart, so the folder reads as settled afterwards and setup picks up at the next step. That move is setup's only restart.

## The window

Setup draws over the app window (no window of its own), with the app loaded behind it. On a launch with no workspace yet, the window draws setup alone until the folder step places one and the window loads again.

- **Size.** A first launch opens at 1080×720, fixed (not resizable, maximizable or full-screen), centered on the pointer's display. Finishing turns resizing back on and sets the remembered bounds; the old onboarding window's grow animation and the warm-behind swap are gone with it. Bounds are never saved while setup is sized, on close and quit included (`trackWindowBounds`). Someone shown one new step after an update keeps the window as they left it. Off macOS, setup draws minimize and close itself.
- **Held back while setup is up:** the minimal menu (`createOtherWindowMenu`), the window's chords (`bindAppWindowChords`), tab commands and the command menu (a window hold with no close), and swipe back and forward.
- **Files and links opened from outside** wait in main and are delivered when setup finishes (`window.command`), and setup says what is waiting.
- **Gone:** `windows/onboarding.ts`, `client/routes/onboarding/`, the warm-behind machinery in `app-window.ts`, the `windowType` "onboarding" plumbing, the dev panel and command menu entries, the debug gallery's onboarding screens. The login modal keeps its screens until the shared sign-in replaces them. `OnboardingZoomRoot` is the app window's zoom root too, so it is renamed, not deleted.

## Signing in: one flow per provider, one set of answers

Onboarding, the Add a provider sheet, Settings and the notes above the reply box share one connect flow per provider and one list of answers (`ConnectOutcome`, `shared/connect-outcome.ts`), and differ only in how they draw them.

- **Google (Instrument):** browser sign-in, with a timeout. Answers: ready, declined, canceled, sign-up refused, failed. The plan comes from `billing.status`, as everywhere else.
- **ChatGPT and Claude:** browser sign-in, then the account check (`checkAccount`: one small request on the plan), with a deadline and Cancel. Answers: ready, no paid plan, out of usage (with the reset time), signed out, canceled, failed. The default model is set only once the check says ready, so a failed account never becomes the default.
- **Grok:** device code (the page shows the code beside Cancel); the plan is read at sign-in (`no-subscription`, SuperGrok or X Premium+).
- **Copy:** one module turns an answer into words for each surface. Network trouble is not an answer of its own: the offline pill says it ([network-status.md](network-status.md)).

A result that arrives after the person has left the page is dropped, and a retry that lands on the same page resets its waiting state.

## Plans and the trial

Plans, trials and the beta offer are chosen on the website, never in the app ([auth-callback-server.md](../architecture/auth-callback-server.md)). A Google sign-in for an account with no plan goes on to the website's plans, and choosing AI waits there until a plan or a trial lands. Canceling that wait leaves the account signed in, so Google's button becomes See plans, which opens the plans again and waits the same way, beside the subscriptions and a key.

- **ChatGPT, Claude, Grok and keys need no plan**, so those ways never see the plans; they see the free-account offer instead.

## Building it

What carries over from the earlier drafts is logic and tests, never UI: account-check routing and reset times, suggested models for a key, the stale sign-in and key-check race guards, the dev jump to any step, and the welcome hero's Reduce Motion handling. Every page is built from `components/ui`, the billing components, and main's existing pieces (`theme-screen.tsx`, `add-provider/form.tsx`, `model-picker.tsx`, `storage-section.tsx`, `workspace-move.ts`).

Four streams run in parallel, then the pages:

1. **Setup logic.** The facts, the record, `currentSetupStep` with tests (every step, quit at each, the finished rule, a step added later), the `setup` RPC routes, removing `hasCompletedProviderSetup` and `onboardingVersion` and their writers, and scenarios (below).
2. **The window.** Everything under "The window", against `isSetupUp()` (`electron-main/lib/setup-state.ts`).
3. **Shared sign-in.** The connect flows, `checkAccount`, and the copy module, wired into the Add a provider sheet, Settings and the reply-box notes.
4. **Offline.** [network-status.md](network-status.md).
5. **The pages**, once the first three are in, from Figma frame by frame.

## Scenarios

A scenario boots the app straight into one state: `studio-drive.mjs boot --scenario <name>` seeds a workspace and writes the facts and the record, so the gate follows from files alone. The first ones are setup's: new (no workspace), beta tester (chats in app data, `~/Documents/Instrument` present), quit after picking the folder and connecting ChatGPT, waiting on the folder move's restart, finished with a step added later, and offline. Account states come from the preview test accounts (`--account`). Notification status comes from macOS, so the bridge takes a development-build override. This is the first part of [app-state-scenarios.md](app-state-scenarios.md), built on the record instead of `hasCompletedProviderSetup`.

## Testing

Unit tests cover the step order (`currentSetupStep` over facts and records), each connect answer's routing and copy, the window-bounds guard, and asks held and delivered. Scenarios cover every setup state on screen. What needs a real account or a signed build (each provider's paid, free and out-of-usage accounts, a new Google account's trial, the beta offer, a key, the test notification's click) is a manual pass, listed in FP-1368.
