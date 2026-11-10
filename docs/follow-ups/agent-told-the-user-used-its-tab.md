# What counts as the person using a tab when nobody touched it

**Status:** open · **Check after:** 2026-11-24, or once a build carrying the `person input` log line has run a week of real browser chats and one recorded agent run · **Last checked:** never

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

Not yet checked.
