# Plan: the onboarding setup assistant

Status: designed, not built on main. The final designs are in Figma (Instrument 2.0 file, node 4238-2276), which is the source of truth for every screen and its copy. A rough-draft implementation was built from an earlier wireframe round; it proved the shape below but needs a large update to match Figma and is not a merge candidate. Billing (plans, trial, beta offer) lands on main first; onboarding builds on it. Tracked in Linear FP-1356 (design) and FP-1368 (testing against real accounts).

Onboarding is what a person goes through from first launch to an app that works: a way to get AI (an Instrument plan, a ChatGPT or Claude plan, or their own API key), the setup every way in shares (memories, the workspace folder, notifications, what fills their week, the look, a few suggested tasks), and the move into the app with those tasks waiting as drafts.

## What the draft settled

These held up in the draft and carry into the build.

- **One window.** Setup draws over the whole app window instead of opening a window of its own. The app loads behind it, so finishing fades setup away onto an app that is already there, and sending someone back through onboarding is a reset of one number and a reload. While setup is on screen the menu is the minimal one, the window's shortcuts and tab navigation wait, and files or links opened from outside wait until it finishes.
- **The window's size.** A first launch opens the window at setup's own size (1080×720), fixed: not resizable, maximizable, or full-screen, and its bounds are not saved. Finishing grows it to the remembered bounds with an animation. Someone sent back through onboarding after an update keeps the window as they left it. Off macOS the window has no system frame, so setup draws minimize and close itself (and maximize only when the window can be resized).
- **When it shows.** A version number in workspace state (`onboardingVersion`) gates it, so an update that adds a step brings setup back for everyone; a returning person starts on a "Welcome back" page instead of Welcome.
- **The step model is pure.** One reducer (go, replace, back, answer, way) holds the page, the history for Back, and the answers, so the order of pages is checked without drawing them. Dev builds can jump to any page by name.
- **A ChatGPT or Claude account is checked before setup moves on.** Connecting is not enough: setup reads the plan and sends one small request on it, then routes on the answer. Ready goes on; not eligible (a free plan, one that ended, or a workspace that turns off other apps; the providers report all three the same way) gets a page that says the account can't be used here; out of usage gets a page with the real reset time that lets setup finish without the step that needs AI; signed out or an answer the check can't read gets a "couldn't connect" page with Try again and the other ways in, and no way through. Claude's check can take about 15 seconds, so the page says it is checking.
- **No step that spends AI can trap anyone.** Each such step is skippable throughout, says so when it fails (Try again), says so when it is slow (after 10 seconds: Keep waiting), and offers the non-AI fallback (starter tasks in place of written ones).
- **The beta offer is the server's to give.** Whether someone sees it comes only from the API's answer about their account, never from anything the app decides, so coupon codes can come in the same way later. Accepting is a $0 Checkout.
- **A trial the server cannot start says why.** When the day's free trials are taken, the plans page says so and keeps Subscribe.
- **Own key.** After the key is accepted, the person picks the model new chats use, and a toggle says whether setup may spend that key writing their suggested tasks. A model list that has not loaded after 10 seconds offers Skip.
- **Notes above the reply box.** A ChatGPT or Claude plan that runs out, or an account that can't be used here, ends the turn with one line in the transcript; the note above the reply box carries the ways on (switch AI, wait for the reset, see the usage, connect another AI). This replaces the recovery buttons the transcript's error card carries for those two providers.
- **Words.** The theme choice that follows the computer is "Auto", as in Figma and the rest of the app. Once suggested tasks are showing there is no Skip; unchecking them all is the way past.

## Requirements the draft did not meet

- **Quitting at any step.** Onboarding must pick up correctly after a quit on any page. The draft decides "returning" from `hasCompletedProviderSetup`, which a new person sets by connecting a provider, so someone who quits after connecting comes back to "Welcome back" as if they were a beta tester. That is a bug to fix, and the quit-anywhere case needs its own test pass.
- **The workspace folder.** Onboarding gets a screen that requires choosing the workspace folder, built on main's pick-and-move ([choose-where-instrument-keeps-files.md](choose-where-instrument-keeps-files.md), [workspace-layout.md](workspace-layout.md) "The onboarding folder step"). The draft's folder step kept an output-folder setting of its own and held folder creation until setup finished; none of that carries over.
- **Drafts on the first launch.** The tasks and memory imports picked during setup arrive as drafts. On the first launch the inbox shows drafts and chats together, ordered by time, with a filter that shows only drafts.
- **Adding another provider from inside the app.** The sheet behind every "add a provider" entry point still has the old small-window design and shows every option whatever is connected. It is being redesigned: it hides each sign-in that is already connected, falls back to adding a key by hand when nothing else is left, and covers Grok as a third subscription provider beside ChatGPT and Claude. Whether a second ChatGPT account gets a place there is part of that design.

## Building it from Figma

The draft is rebuilt on main's components, not merged. About a quarter of its UI was composed from `components/ui` and the billing components; the rest copied main or was drawn by hand, so what carries over is its logic, its tests, and a few patterns.

**What the draft got wrong.** It re-implemented ChatGPT and Claude sign-in beside `chatgpt-login-button.tsx` and `claude-login-button.tsx` (toast copy and the install-percent helper included), key entry beside `add-provider/form.tsx`, a model list with no search beside `model-picker.tsx` and `lib/model-picker-rows.ts`, and the theme screen beside `onboarding/theme-screen.tsx`. It hand-rolled a toggle, checkbox, input, cards, and buttons that `components/ui` has, and used raw hex colors.

**What carries over.** The step reducer with its Back history (`flow.ts`, which needs a test). The tested pure logic: account-check routing and reset times, which models to suggest for a key, plans, starter tasks, and drafts. The guard against a stale sign-in, the race guard on key checks, the dev jump to any page, and the welcome hero's Reduce Motion handling.

**Each frame and where it comes from.**

| Source | Frames |
|---|---|
| Main as it is | 05 Choose a folder and 08 Folder already exists (`settings/storage-section.tsx`, `workspace-move.ts` `checkPlace`); 10, 12, 13 notifications (`rpc/routes/mac.ts` notification status and request, `sendTestNotification`, `lib/notification-settings.ts`); 14 Choose your look (`onboarding/theme-screen.tsx`); 16 and 17 Claude sign-in (`claude-login-button.tsx`, `chatgpt-login-button.tsx`); 20 Free account (`google-login-button.tsx`); 21 to 23 and 25 adding a provider (`add-provider/form.tsx`, `provider-picker.tsx`); 26 Connect OpenRouter (`add-provider/connect-openrouter.tsx`); 28 and 29 model list and search (`model-picker.tsx`); the logo set (`ai-provider-icon.tsx`, `model-maker-icon.tsx`) |
| Adapted from the draft | 01 Welcome (the hero and burst); 02 and 03 plans and trial, once billing is on main; 04 Choose a model (the suggested-models logic); 18 No paid plan and 19 Out of usage (account-check routing); 24 Key accepted; 15 All set (suggested tasks); 30 Welcome back, after the returning-person fix; the page frame, rebuilt as Figma's title bar and footer |
| New | 06 Documents access and 07 Documents denied (create the folder on Continue so macOS asks, fall back to the home folder if refused, offer a fix); 09 Earlier chats found (the move check knows a workspace is there, not how many chats it holds); 11 Test notification (knowing it was clicked and bringing setup forward); 27 No credits (needs an OpenRouter credits signal); Figma's component set: footer variants, model, folder, and notification rows, plan and way cards, brand tile |

**Order.**

1. Port the pure logic and its tests, adding one for the step reducer.
2. Build Figma's component set as a setup kit on `components/ui`, with no hand-rolled controls.
3. The shell: one window, the fixed size, the version gate, and picking up after a quit.
4. The pages main already covers: folder, notifications, look, provider form, model picker.
5. Lift sign-in and the account check out of the login buttons into hooks Settings and setup share, then frames 16 to 20.
6. Plans, trial, and Welcome back.
7. The new pages: Documents denied, Earlier chats found, No credits, the test notification.
8. Illustrations and the hero last.

Exact spacing and tokens come from Figma per frame during the build; this map does not carry them.

## Open gaps

- **A slow-web-search note.** The designs include a note above the reply box, in the app after setup, for someone who passed on the free Instrument account and so has slow web search, offering that account again. Nothing in the app can tell that a search is slow, so it waits on that signal.
- **The main model in Settings.** The own-key step sets the default model for new chats, but Settings shows that default nowhere, so a choice made in setup can only be changed from a chat.
- **The old onboarding window is still on main.** The setup assistant replaces it, its routes, and its dev panel entry.

## Testing

Unit tests cover the step order and the routing of each account-check answer. Everything that depends on a real account (paid, free, out of usage, a workspace that turns off other apps, for ChatGPT and for Claude; a new Google account's trial; the beta offer; a real key) is a manual pass, listed in FP-1368.
