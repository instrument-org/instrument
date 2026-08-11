# A page the user asked to see does not appear, because driving the browser never opens the pane

**Status:** open, recorded 2026-08-11. Measured by `show-a-page` in [show.ts](../../packages/workspace/evals/cases/show.ts).

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

A model reaching for the browser has already loaded the skill that tells it how to browse. Nothing in that path mentions the pane, so the more discoverable route is also the one that leaves the user staring at an unchanged screen. The auto-open hooks that used to paper over this were deliberately removed with the pane landing ([pane-tabs-and-the-show-command.md](../plans/completed/pane-tabs-and-the-show-command.md)); `show` is what replaced them, and for URLs it is not winning.

Worth separating from the file case, which is not broken in the same way: both models did open files into the pane, and their disagreement there was about whether to *also* name the file in the fence. Only the URL path fails outright.

## What would fix it, in rough order of appetite

- **Open the pane when the session's browser first navigates in a turn.** The state change is already recorded by `recordBrowserUse`, so this is a publish away. It re-introduces an auto-open, which is exactly what the pane plan removed, so it needs to be argued rather than assumed: the case against auto-open was files appearing unbidden, and a page the user asked for is a different act.
- **Say it in the browsing skill**, where the model is already reading. Cheapest, and the least reliable, since it competes with every recipe on the same page.
- **Accept it** and treat the browser as an agent tool whose output reaches the user through the reply. Defensible, but then "so I can see it" is a request the product cannot honor.

## The general shape

An affordance competes with whatever else can accomplish the same task, not with nothing. `show` was specified against the alternative of doing nothing, where it reads as obviously correct, and deployed against the alternative of `agent-browser open`, which is better documented and does four fifths of the job. Where two paths reach the same outcome and only one updates the interface, the interface update belongs on the shared path underneath them both.
