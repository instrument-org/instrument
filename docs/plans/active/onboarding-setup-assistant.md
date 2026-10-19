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
- **Words.** The theme choice is "System", as in Settings. Once suggested tasks are showing there is no Skip; unchecking them all is the way past.

## Requirements the draft did not meet

- **Quitting at any step.** Onboarding must pick up correctly after a quit on any page. The draft decides "returning" from `hasCompletedProviderSetup`, which a new person sets by connecting a provider, so someone who quits after connecting comes back to "Welcome back" as if they were a beta tester. That is a bug to fix, and the quit-anywhere case needs its own test pass.
- **The workspace folder.** Onboarding gets a screen that requires choosing the workspace folder, built on main's pick-and-move ([choose-where-instrument-keeps-files.md](choose-where-instrument-keeps-files.md), [workspace-layout.md](workspace-layout.md) "The onboarding folder step"). The draft's folder step kept an output-folder setting of its own and held folder creation until setup finished; none of that carries over.
- **Drafts on the first launch.** The tasks and memory imports picked during setup arrive as drafts. On the first launch the inbox shows drafts and chats together, ordered by time, with a filter that shows only drafts.
- **Adding another provider from inside the app.** The sheet behind every "add a provider" entry point still has the old small-window design and shows every option whatever is connected. It is being redesigned: it hides each sign-in that is already connected, falls back to adding a key by hand when nothing else is left, and covers Grok as a third subscription provider beside ChatGPT and Claude. Whether a second ChatGPT account gets a place there is part of that design.

## Open gaps

- **A slow-web-search note.** The designs include a note above the reply box, in the app after setup, for someone who passed on the free Instrument account and so has slow web search, offering that account again. Nothing in the app can tell that a search is slow, so it waits on that signal.
- **The main model in Settings.** The own-key step sets the default model for new chats, but Settings shows that default nowhere, so a choice made in setup can only be changed from a chat.
- **The old onboarding window is still on main.** The setup assistant replaces it, its routes, and its dev panel entry.

## Testing

Unit tests cover the step order and the routing of each account-check answer. Everything that depends on a real account (paid, free, out of usage, a workspace that turns off other apps, for ChatGPT and for Claude; a new Google account's trial; the beta offer; a real key) is a manual pass, listed in FP-1368.
