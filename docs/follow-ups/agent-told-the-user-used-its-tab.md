# What counts as the person using a tab when nobody touched it

**Status:** open, narrowed to a key event the person never pressed (see Result) · **Check after:** 2026-12-12 · **Last checked:** 2026-11-28

## What we're waiting to learn

An agent's bash result can end with a line saying the user used one of its tabs moments ago (`tabNewsNote`, from `noteTabCommand` in `packages/workspace/src/lib/tab-activity.ts`). In a recorded run nobody had touched the tab. The guest's `input-event` handler in `apps/studio/src/electron-main/browser-view/manager.ts` counts a mouse down, key down, tap or touch as the person's whenever no agent command holds the tab's focus guard (the command plus a 500 ms tail, `focus-guard.ts`), so the input landed between two agent commands while the model was thinking. The likeliest source is a key or click the recording harness sent to the app window, which Chromium routes to the guest that last had keyboard focus. That is unverified: the run kept no main log.

The commit that adds this follow-up records the input's type on the guest (`userInputType`, set by `noteUserInput`) and logs the input that starts each run of person input, before changing what counts.

## The signal

Search the main log for `person input targetId=<id> type=<type> windowFocused=<bool>`, one line per run of input counted as the person's (none again for that guest until five seconds pass without one).

| What shows | What it means |
| --- | --- |
| A line during an agent run nobody touched, `type=rawKeyDown` or `keyDown` | A key reached the guest from outside it: a harness or system key event, not the agent |
| Such a line with `type=mouseDown` | A click on the guest from outside the agent's commands, such as a harness click on the window |
| Such a line with `windowFocused=false` | The input reached a guest whose window was not focused, which a person at the keyboard rarely does |
| Lines only when a person was really at the tab | What counts is right; the earlier note was the harness |
| No false note seen in the period | Not recurring; close |

## Where to look

- The main log (`logs/main.log` in the app's user data folder) of a recorded agent run that shows the false note, matched by time to the note in the chat's records.
- A beta tester's report that quotes an agent saying the user used a tab they did not touch.

## What each answer means

- Keys or clicks from a harness only: leave the rule alone and make the recording harness stop sending input to the app window during agent runs.
- A kind of input that arrives without anyone (a key event the system sends, a synthetic tap): stop counting that type in `noteUserInput`.
- Inputs that came while the window was not focused: count only input that reaches a focused window as the person's.

## Result

2026-11-28, from the main logs of two Macs in daily use on the 2.0.10 and 2.1.0 betas (one log from 2026-11-17, the other from 2026-11-26) and the records of the workspace both use. No recorded agent run was in the period.

- **The notes are rare and the ones checked were true.** Since 2026-11-11, 23 chats ran agent-browser commands, and a bash result told the agent the user used a tab three times. Two fall inside a log: each was a run of `rawKeyDown` with `windowFocused=true` while a browser extension selected and closed tabs on those keys, so a person was pressing keys in that tab. The third came from the Mac whose log starts later.
- **Real input is `rawKeyDown` or `mouseDown`.** Of 4,089 runs counted as the person's across both logs, 2,678 started with `rawKeyDown`, 1,410 with `mouseDown` and one with `keyDown`; five of them came with the window not focused.
- **That one `keyDown` was almost certainly not the person.** It reached another tab of the same chat 1 ms after the window reclaimed keyboard focus from an agent's `press Meta+a`, which had taken focus because the chord has no key translation ([agent-typing-without-focus.md](agent-typing-without-focus.md)). No note reached the agent, but the guest counted it as the person's input, which is also what lets a page offer a link to another app (`mayOpenInAnotherApp`).

What to watch now: `person input … type=keyDown` lines. Another one just after a `takes focus` line means a key from the agent's focus-taking fallback lands in a guest the focus guard does not cover: guard every guest of the window while a fallback holds focus, or stop counting `keyDown` in `noteUserInput` once a Windows log shows that a real key arrives as `rawKeyDown` there too. None by the check date: close.
