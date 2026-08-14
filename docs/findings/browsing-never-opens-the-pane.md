# A page the user asked to see does not appear, because driving the browser never opens the pane

**Status:** resolved. Recorded 2026-08-11, fixed 2026-08-12. Measured by `show-a-page` in [show.ts](../../packages/workspace/evals/cases/show.ts).

Asked "Pull up example.com so I can see it", both models tested navigated the task browser and left the pane closed, so nothing appeared on screen. The user's request was satisfied inside the agent and invisible outside it.

```
claude-sonnet-latest   pane closed, selected (none), tabs (none)
gpt-5.6-luna           pane closed, selected (none), tabs (none)
```

Two of two, on models that otherwise behave differently on the same suite, which makes it structural rather than a quirk of one family.

## Why it happens

There are two ways to put a page on screen and only one of them is a product affordance.

- `agent-browser open <url>` navigates the managed target. It is documented at length in a skill the model loads, it is what every browsing recipe in that skill uses, and it does not touch the pane.
- `show <url>` navigates the same target *and* opens the pane onto its browser tab. It is one line in a shell-command description.

A model reaching for the browser has already loaded the skill that tells it how to browse. Nothing in that path mentions the pane, so the more discoverable route is also the one that leaves the user staring at an unchanged screen. The auto-open hooks that used to paper over this were deliberately removed with the pane landing ([pane-tabs-and-the-show-command.md](../plans/completed/pane-tabs-and-the-show-command.md)); `show` is what replaced them, and for URLs it was not winning.

Worth separating from the file case, which was not broken in the same way: both models did open files into the pane, and their disagreement there was about whether to *also* name the file in the fence. Only the URL path failed outright.

## The variant a closed pane hides

The eval measures a pane that is closed, where the user at least sees nothing. An open pane on a stale tab is the worse form, and it is what a real session produced: an earlier turn had shown an HTML mockup, the agent then drove the browser through a live page for the rest of the session, and the pane went on displaying the mockup. The reply described the live page. The user was looking at the artifact they had already rejected.

Two things kept the agent from noticing. The browser is never in `pane.tabs` — [openTabs](../../packages/workspace/src/schemas/task-pane.ts) filters it out and the renderer draws it as a fixed first tab — so the turn's pane-tabs context part structurally cannot mention it, and it reports tabs rather than the selection. What the agent was told instead was that the mockup was already open and there was "no need to re-show any of these".

This is why the fix cannot be "open the pane when the browser navigates". The pane was already open.

## What landed

Reveal moved onto [recordBrowserUse](../../packages/workspace/src/lib/browser-state.ts), the recorder that both `show` and `agent-browser` already reach, and it selects the browser tab rather than merely opening the pane. Naming a URL is what separates arriving somewhere from the rest of the traffic through that function: a target opened for a command that only reads state carries no URL, a command that read the page it was already on carries the one already recorded, and neither moves the pane. `about:blank` is excluded for the reason the browser status part already excluded it.

Selection is not insertion. The browser tab is one the pane always draws, so nothing is closed and no file the user opened is discarded; every one of them stays a click away in the strip.

A reveal happens at most once per turn. The turn is the unit because it is the unit of the user's attention: they asked for something, so the first page it produces is theirs to see, and where they go afterwards is their own. An agent reading twenty pages over several minutes would otherwise drag the pane back twenty times, past whatever the user deliberately turned to instead. The bound is a latch in session storage, lowered as each user message is composed, rather than a comparison against what the pane currently shows — a user who clicked back to a file has said where they want to be, and the pane cannot tell that apart from never having moved.

An explicit `show` is unaffected either way: it selects the tab itself, so it focuses whether or not the turn has already spent its reveal.

One consequence for the suite: `show-a-page` now passes whichever route the model takes, so it has become a regression test for the mechanism rather than a measure of whether models reach for `show`. The file cases still measure adherence.

## The general shape

An affordance competes with whatever else can accomplish the same task, not with nothing. `show` was specified against the alternative of doing nothing, where it reads as obviously correct, and deployed against the alternative of `agent-browser open`, which is better documented and does four fifths of the job. Where two paths reach the same outcome and only one updates the interface, the interface update belongs on the shared path underneath them both.
