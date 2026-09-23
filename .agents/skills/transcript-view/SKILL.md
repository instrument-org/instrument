---
name: transcript-view
description: Render an exported Instrument transcript as a readable HTML page for a person, the run laid out like the chat it was, with each activity's actions and durations open underneath. Only when the user asks for it by name.
disable-model-invocation: true
---

# Transcript view

A page for a person, not for an agent: the conversation as bubbles (the user's on the right, the agent's replies on the left), and between them every activity the agent announced, open, with each action in the words of the explanation it gave and a duration colored by length. A thread's tasks sit inline as inset cards where they ran. An action opens to its command and the start of its output.

```bash
node .agents/skills/transcript-view/scripts/render.mjs <transcript.md> [--out page.html] [--children]
```

- Without `--out` the page lands next to the transcript as `<name>.html`. When the user's own instructions name a folder for visual answers or pages, write it there with a dated name instead.
- Pass `--children` for a thread (task name "Instrument"): it finds the tasks the thread started in this Mac's task folders and exports each, the same way `transcript-digest --children` does.
- The page is one self-contained file with no network dependencies and follows the system's light or dark theme.

Hand back the path. Do not also summarize the transcript unless asked; this skill is the view, and analysis is `transcript-digest`'s job.

## What the page relies on

The parser is `transcript-digest`'s (`../transcript-digest/scripts/parse.mjs`), so a format change is fixed once there. Activities come from `start_activity` calls; a run whose model announced none falls back to grouping steps under their first action, which reads as one long block. Durations are the export's own timestamps.
