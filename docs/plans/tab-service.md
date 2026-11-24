# One owner for every tab

Status: open. The back history of a discarded page, the table of where opens land, and keeping a page a person entered something into are done. Nothing of the service is built.

## Problem

Each window keeps the tabs of every group in its own store, changes them there, and writes a group's whole record to the main process, which stores it and passes it on ([`kept-state.ts`](../../apps/studio/src/electron-main/stores/workspace/kept-state.ts)). The last write wins. Two windows that each open a tab in one group before hearing of the other end up with different tabs, and the file keeps one of the two. Nothing later brings them back together, since each window holds what it last heard.

Around that, one tab's facts are spread over several places and inferred from each other:

- Whether a tab is the agent's is read from the group it stands in, a mark on it, and which window made its guest.
- A page with no place in a strip stands in a hidden `page:<id>` group so that it has a group at all.
- Which guests are alive follows from a comparison of the tabs drawn and the guests made (`reconcile-guests.ts`) in each window.
- An agent's ask goes to one window's renderer, which answers or times out. With no window able to answer, the agent has no tabs.
- An open is decided by twelve options read in a different order for a page, a screen, an app and a chat.

## Design

A tab service in the main process owns every tab. A window draws what it says and asks it for changes, and so does an agent.

### What a tab is

Five separate facts, none derived from another:

| Fact | Values |
| --- | --- |
| Content | A page or a screen, with its history |
| Owner | The person, or a chat whose agent made it. The person using it makes it theirs |
| Place | Unlisted, or a group, a side and a position |
| On screen | Which windows draw it. Read from what each window shows, never stored |
| Life | Live, asleep or discarded |

A tab's id never changes: not when it moves, changes owner, comes into a strip or goes to another window. An agent makes unlisted tabs and tabs in groups the person has, and never makes a group.

### How a change travels

1. A window sends a command: open, place, select, close. It names ids, so a command means the same whatever else has happened.
2. The service applies commands in the order they arrive, through the same pure functions the windows use (`tab-model.ts`), and gives each result the next revision number.
3. It sends the change, with its revision and the command it answers, to every window.
4. A window shows its own commands at once, over the last state it heard, and replays the ones not yet answered over each new state. A window that misses a revision asks for the whole state.

A command that no longer applies (a tab closed under it) does nothing, and the window shows what the service has.

### What lives and for how long

One list of tabs by last use and one budget, sized from the computer's memory, for pages and screens alike. The rest go oldest first past the budget, and sooner under memory pressure. A page put away keeps its address and what was behind it.

A tab is never put away for the reasons a browser built on Chromium keeps one, each read from the tab rather than guessed. The discard clocks there are today keep all of them, so the budget takes the list as it stands:

| Kept while | Read from |
| --- | --- |
| On screen | What each window draws |
| Playing sound, downloading, or open in DevTools | The guest |
| In a call on the microphone or camera | The page's own tracks, told by its preload |
| An agent is working in it | Its commands and its turn |
| A person entered something since the page loaded | A real `input` in a field, told by its preload, and a field the browser filled again on Back or a reload. A character typed into a frame below the main one counts, since nothing says where it landed |

A key pressed in a page is not on the list: nearly every page a person has looked at has had one, and a budget that kept them all would put nothing away.

Chromium's other reasons are left out. A page here is given no USB or Bluetooth device and no notifications, so it holds neither. A PDF comes back at its start, which loses a place and nothing entered. A list of sites to always keep is a setting, to add when someone asks for it.

### What stays

Pages stay `<webview>` guests, each window stays its own renderer, and a page that moves to another window is made again there unless the window itself is carried. The group files stay where they are.

## Steps

Each lands by itself and leaves the app working.

- **A. Pin what it does.** The table of gestures by kind in `use-openers.test.tsx`, beside the reducer tests there are. Done. A blank New Tab gives its place to a plain click on anything, an app and a chat included; one with a draft in it, or on a side of a split, keeps its place.
- **B. The service.** The pure functions move to shared code with no atom, router or DOM in them. Main owns the state and the windows become mirrors of it. The shape of the files is unchanged, so an earlier build still reads them. This ends the overwrite.
- **C. Pages follow the tabs.** Main makes and ends guests from the tabs' Life. Unlisted tabs replace hidden groups, and a `page:<id>` group found in a file becomes one. An agent's asks are answered in main, with or without a window.
- **D. One budget.** The list and the budget above replace the separate limits on guests and on kept screens.
- **E. One open.** One call takes what to open, the gesture and where it was asked from, and one table answers. `OpenOptions` goes. A closed tab, side or group becomes one kind of record.

## Validation

- Random sequences of commands from two windows and an agent end with every mirror equal to the service.
- The table from step A, unchanged through B, C and D. A changed row in E is a decision.
- In the running app, after B and again after C: two windows on one group; a tab dragged within a strip, across sides, between groups and to another window; a page with typed text and one playing sound through each of those; an agent's unlisted page opened into a split with its text intact; reopening a closed tab, side and group; quitting and launching again; a launch on files an earlier build wrote.

## Risks

- **Hidden pages.** A live page no tab has, with text typed in it, keeps its page and its text when another window's change puts it on a side of a split. Checked in the running app, so step C can place a tab without making its page again.
- **Routers.** A screen tab walks in its own router, which lives in the renderer. Its history is content the service stores, but a step is still taken in the window, so a step is a command after the fact.
- **Two windows on one tab.** Only one can have the guest. Which one is a rule in the service.
- **Files.** A build that reads a newer unlisted tab must not drop it. Unlisted tabs are kept under a key an earlier build ignores.
- **Size.** Thirty-six renderer files read or change the window's tabs. B keeps `useWindowTabs` as their interface so they change later and separately.
