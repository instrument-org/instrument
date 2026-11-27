# Tabs, groups and the address field behave as a browser's

People bring years of Chrome and Safari habits to a window of tabs, and a rule browsers have shipped is already tuned against real pages. Where a tab, group or page needs a rule (where a tab opens, what a close gives way to, what Back does, which closed tab comes back, when a page holds unsaved input), take Chromium's, read from the same signal it reads, and say which of its rules were left out and why. Invent one only where no browser has it.

**Applies when:** placing, closing, restoring or discarding tabs and groups; what the address field does; anything that opens a page.

- The area beside the sidebar is always a tab group, with its tabs and address field. No mode, inbox or simplified home replaces it; chat lists and switchers live in the sidebar, the command menu, the address field or a new tab.
- The address field is an address bar on every tab: the same predictable field, opening or searching what is typed, never a control that changes role with what the tab shows.
- A tab whose file or folder is gone stays where it is and says so in place, as Chrome's tab does for a `file://` page that failed to load, and shows it again once it is back. Something outside the app moving or deleting a file never closes a tab, steps it back or walks it up; only the person's own action in the app does.

**Not:** a reason to copy browser chrome for features the app lacks, or to guess a signal from keys pressed when the page can report it.

**Sources:**
- [Windows](../architecture/windows.md) and [`tab-openers.ts`](../../apps/studio/src/client/components/window/tab-openers.ts): opener order, Back closing a link-opened tab, group return, 2026-11-24.
- [Tab service](../plans/tab-service.md): Chromium's reasons to keep a page, 2026-11-23.
- Reopen Closed Tab, and a new tab that went nowhere is not recorded, after Chrome, 2026-11-09.
- The area beside the sidebar is always a tab group, stated 2026-11-18.
- The address field is an address bar on every tab, stated 2026-11-25.
- A tab whose file is gone stays and says so in place, stated 2026-11-27 after a folder reshuffle closed a group's tabs one toast at a time.
