# One tooltip at a time, and only when it adds something

Hovering anything in the app shows at most one tooltip, and only one that says something the screen does not. Two at once (the app's own and a native `title`, or a mark's tooltip inside a row's) read as a glitch and cover what the person was pointing at; a tooltip repeating the words on the row is noise.

Which kind:

- **A control with only an icon** names itself with the app's tooltip (`Tooltip`, or `ToolbarTooltip` in a toolbar, which adds the shortcut). Near the window's top edge it opens below.
- **A row or label with text** gets no tooltip, unless the hover adds a fact the row leaves out: a page's address, the whole of a shortened date ([A shortened date shows the whole one on hover](a-shortened-date-shows-the-whole-one-on-hover.md)). That one is a native `title`, which costs a list nothing.
- **A mark inside a row** (a favicon, an app's icon, a project's mark) brings no tooltip of its own: the row's name says what it is. `Favicon` takes `hasTooltip={false}` there, and `AppIcon` and `ProjectMark` never add one.
- **One row, one kind.** Controls side by side use the same kind, so a toolbar never mixes native titles with the app's tooltips.

`studio/no-title-under-tooltip` (`apps/studio/oxlint-rules.ts`) catches the doubles it can see in one file: a native `title` or an SVG `<title>` under a `TooltipTrigger` or `ToolbarTooltip`, and a `Favicon` with its tooltip on inside either one or inside an element with a `title`. A component that brings its own tooltip into another file's row is beyond it, which is why marks carry none.

**Applies when:** adding a `title`, a `Tooltip`, or a component that draws either, anywhere in the app.

**Not:**

- A reason to add a tooltip to a row whose text is whole on screen.
- A ban on native titles: they are the right kind for a row's extra fact.

**Sources:**

- The side panel's app icons showed the app's name and the site's host at once, and its Files and bookmark rows repeated what they showed; ruled 2026-11-27, with an audit of the app the same day.
