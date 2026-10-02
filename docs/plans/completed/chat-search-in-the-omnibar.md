# Plan: find chats and tasks from the omnibar

Status: not built, and superseded. Each tab's omnibar searches only what that tab holds (the web on a page, the folder on the computer, apps on an app page, tasks on a task page), so finding chats and tasks from any tab no longer fits it; a cross-app lookup would need a surface of its own.

The classic window had a Cmd+K command menu that searched tasks, projects and debug scenarios by name, with recent tasks as its empty state and a handful of commands (developer mode, release channel, check for updates). It went with the classic window. The app window's omnibar (`apps/studio/src/client/components/window/omnibar.tsx`) searches places, bookmarks, recents and a few `!` commands, but not what people have been working on.

The idea is to bring the lookup back inside the omnibar, not as a second palette: typing into the window's field also finds chats (by title and latest line) and tasks (by name), and Cmd+K focuses that field the way Cmd+L does.

## Where the old one is

At commit `6d06cb144` (the last one before the classic window was removed), restore with `git show 6d06cb144:<path>`:

- `apps/studio/src/client/components/studio-command-menu.tsx`: the menu. Fuzzy ranking with `uFuzzy` (`intraMode: 1`), `joinFuzzyFields` for the haystack, and `FuzzyHighlight` for the matched ranges; pinned tasks first with no query, projects offered only while searching, debug scenarios by name.
- `apps/studio/src/client/atoms/command-menu.ts`: its open state.
- `apps/studio/src/client/components/command-menu-cta.tsx`: the sidebar button that opened it.

The omnibar already uses `uFuzzy` the same way, so the ranking carries over; what changes is the sources.

## What it would search

- **Chats**: `workspace.chats.list` (title, latest line, topics). Opening one goes to `/chats/<id>`.
- **Tasks**: `workspace.chats.tasks` for every chat (name, the chat it belongs to). Opening one goes to `/tasks/<id>`. Tasks are a detail the chat manages, so they rank below chats and show their chat's name beside them.
- **Topics**: as filters, not places. Choosing one filters the inbox by it.

Commands stay where the omnibar keeps them (`!beta` and the rest).

## Open questions

- Whether Cmd+K focuses the current tab's field or opens a new tab on the inbox with the field focused. The field is per tab, and a lookup from a browser tab should not replace the page.
- Whether the empty state lists recent chats (the old menu's recent tasks) or stays as it is.
- The chat list's AI search fallback (`useChatSearchFallback`) already answers a query no title matches; the omnibar could hand off to it instead of showing nothing.
