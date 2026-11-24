# A prototype, and replaying a chat

A part that defines `META` and `SCREEN` (`{ w, h, draw, controls }`, the skill's `prototype.md`) instead of `states` builds one live screen from the skill's `prototype.html`, with the same build command. It is a JS file, not a part of frames.

[`replay/`](replay/) plays a chat back from its records in a design under exploration, as such a prototype with a scrubber under it. The point is to draw a design against real chats, with their real pauses, long runs of steps, tasks and failures, rather than against made-up ones:

```bash
node .agents/wireframe-kit/replay/build-replay.mjs <chat-records-dir> <page>.html \
  --design <the design's part>.js --title "Chat replay: <what>" --chat "<the chat's title>" [--pictures | --icons]
```

- `<chat-records-dir>` is a chat's `.instrument/chats/<id>/` folder, with its tasks' logs beside its own. An eval keeps one per chat in its run's workspace, a temp folder the system clears in time, so copy the workspace out if the run is worth replaying later.
- `--design` is the part whose pieces draw the replay. The replay takes everything above its `// ---- the scenario` line (or its `META`), and needs `says`, `working`, `workedLine`, `head`, `DOT`, `pillDark`, `pillSoft`, `shimmerText`, `miniDot`, `taskHeader` and `chatBrief` from it, and for a chat that browses, `tabsPill`, `pageTab`, `siteMark`, `usedPage`, `addressRow`, `docPage` and `iconBtn`. A design that changes those changes every replay built from it.
- `--pictures` takes a picture of each tab's page at the pane's width, since the records keep none, so the page's source line should say they were taken at build time. Without it a tab shows a stand-in page. `--icons` fetches only the tabs' favicons, for a chat whose pages are behind a sign-in that a picture taken now would show instead.
- A sign-in the chat asked for (`connect_app`) draws as the app's sign-in card until the app turns up connected, and the chat's row says "Sign in to …" while it waits.
- A line that sums steps up (the live working line, the folded line, the chat's row, a task card) shows the step's `activity`, the short label calls running together share, so it holds still while they run; the list it opens onto names each call by its `explanation`, the one sentence the agent writes for that call.
- `records-to-timeline.mjs` is the reader on its own: `node records-to-timeline.mjs <chat-records-dir>` prints the timeline as JSON, with seconds from the chat's start for every message, step, task step, ask, failed request and wake.

In the page, drag the timeline or use ← and → to jump from one event to the next, Space plays at the real pace (1×, 4× or 8×, picked beside the timeline), and a folded line of steps opens on a click. When the chat browses, its tabs show at the top right; clicking them opens the pane and closes the chat list, and the page Instrument is using glows.
