# A shortened date shows the whole one on hover

Wherever the app writes a date shorter than it is to save room ("Yesterday", "Nov 3", "2 hours ago", a time with no day), hovering it shows the whole date and time. The short form keeps rows narrow; the hover gets back the hour or the day it left out, so the person never has to change a view or open details to learn when something happened.

The hover is a native `title` on the date's own text, with the date from `formatAbsoluteTime` (`client/lib/relative-time.ts`), or `RelativeTime`'s tooltip where that component is used. A `title` adds one string to the row and nothing else: no component, no listener, no change to what the row's click or drag hits, so it is cheap enough for a virtualized list of hundreds of rows.

**Applies when:** a list row, a menu item, a card or a status line shows a date or time cut short.

**Not:**

- A reason to stack hovers. Where the row already shows a tooltip of its own (a visited page's title and address), the date gets none, or the whole date goes into that tooltip.
- Needed where nothing is cut: a time under a day heading, or a full date already on screen.

**Sources:**

- The Files list beside a chat, stated and landed 2026-11-10; extended across the app the same day.
