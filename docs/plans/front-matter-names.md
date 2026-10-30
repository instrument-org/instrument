# The names in a visible file's front matter

Status: done. Built. As built, `context` holds only what the person chose; the chips of what is on screen are worked out live and never written, and dismissing one is kept in the window's memory while the app runs. A web page and an app's front can go in `context` by their own address, and a draft's `model` is not written: the composer has no model of its own per draft yet.

A person can open any of these files in a Markdown viewer, and another client (the phone app) reads and writes some of them. So the keys are a product surface: they are read by someone who has never seen the schema, and written by someone implementing against it. They should say what they hold without a legend.

## The rule

Four questions, the same words everywhere:

- **What it is**: `title`, and the folder or file is named from it.
- **When**: `created` and `updated`. Not `started`, not `at`, not `createdAt`. Written as ISO 8601 in UTC to the second, `2026-10-14T18:22:04Z`, so the same moment is the same bytes on every computer and any program reads it back exactly. The record logs keep milliseconds.
- **What it belongs to**: `chat` and `topic`. A chat is named by its address, `instrument://chat/<id>`, which a viewer can open and a reader strips to the id; a bare id reads the same. A topic is named by its `id`, since chat settings point at a topic by id and a topic folder renamed in a file manager keeps its chats that way.
- **Its own identity**: `id`, in a file the app has to find again after a person moves or renames it, or tell apart from a copy beside it.

A file is either a render or a source. `CHAT.md` is a render: the app rewrites it whole and an edit does not last, and its body says so. A draft, a memory, a topic, a skill and an app are sources: the app reads them back, and a key it does not recognize is kept.

## The files

`Chats/<name>/CHAT.md`, a render. The chat's address is in the front matter for a program and as the first line of the body for a person, since not every viewer shows front matter as something to click:

```markdown
---
title: Quiet dishwashers under $900
chat: instrument://chat/2026-10-14-quiet-dishwashers-7k3q
created: 2026-10-14T18:00:00Z
topic: top_01K8…
---

[Open this chat in Instrument](instrument://chat/2026-10-14-quiet-dishwashers-7k3q). This file is a copy of the conversation that Instrument keeps up to date, so changes made here don't last.

## Find a quiet dishwasher…
```

`Drafts/<date>/DRAFT.md`, a source, with every key the app keeps for it:

```yaml
---
id: 01M5…
created: 2026-10-14T18:22:04Z
updated: 2026-10-14T18:25:11Z
chat: instrument://chat/2026-10-14-quiet-dishwashers-7k3q
topic: top_01K8…
model: openai/gpt-6.1-sol?provider=chatgpt-account
context:
  - dishwasher.png
  - workspace:/Kitchen plans/
  - /Users/sam/Desktop/receipt.pdf
  - instrument://chat/2026-10-12-oven-research-2p9d
---
```

`model` is the model the draft runs on when it is sent, a choice made while composing. At Send it becomes the chat's `model` setting.

`context` is everything that goes with the message, one line each: a file pasted into the draft by its path inside the draft's folder, a file or folder in the workspace as `workspace:/<place>` (the form chat records use), anything else at its absolute path, and a chat by its address. A folder ends in `/`. The app fills the list when the draft is made, from the chips it would have shown; taking a chip off takes its line out. Nothing is re-derived on open, so a no is a line that is not there.

Every key is optional but `id`, which the app writes the first time it reads a draft that has none, so a person can write a draft by hand and the app picks it up:

```markdown
---
topic: top_01K8…
---
Remind me to call the plumber about the leak
```

The phone app writes drafts too, so it follows this shape.

A memory, a source the agent reads as it is, so its body holds only what is remembered:

```yaml
---
chat: instrument://chat/2026-10-21-roofer-call-4m2x
updated: 2026-10-21T15:04:11Z
---
```

`TOPIC.md` holds `id`, `emoji`, `color`, `about`, `created`, and `retired` only when true. The folder is the topic's name.

## Numbered decisions

1. **Dates.** `created` and `updated` in every file a person opens, ISO 8601 UTC. A memory's `at` becomes `updated`. The record logs keep `at` and `createdAt`.
2. **`chat` is the chat's address** in `CHAT.md`, memories and drafts; readers take a bare id too.
3. **A memory's `from` goes.** The chat's address says where it was learned; a copied title went stale when the chat was renamed.
4. **`attached`, `state` and the four keys in it become `context`**, one line each, shaped as above. `topicSource` goes: `topic` is written only when the person picks one.
5. **A draft keeps its `id`; `send` and `sendOn` go.** The id is what a draft is, and what tells two copies of one apart in a folder. Nothing reads `send` or `sendOn`. A `DRAFT.md` with no `id` is given one when the app reads it, rather than passed over as it is today, so a draft written by hand is picked up.
6. **`mimeType` in `DraftRecord` becomes `mediaType`**, as everywhere else.
7. **Keeping what another client wrote.** A memory keeps keys it does not know, as a draft already does.
8. **The transcript export.** `taskName` becomes `chat`, `sessionTitle` becomes `title`, `sessionCreatedAt` becomes `created`, `currentAppVersion` becomes `app`, `taskCreatedWithAppVersion` becomes `startedWithApp`, with every reader (`transcript-digest`, `transcript-view`, `TITLE_KEYS` in `shared/front-matter.ts`) in the same change.
9. **The record header's `title` becomes `startedAs`**: the title a task was started with, apart from the `title` setting a person changes.
10. **`SKILL.md` allows `argument-hint` and `context`**, which the shipped skill-creator skill tells agents to keep.
11. **`APP.md`**: `baseUrl` becomes `url` throughout, `name` goes since the folder is the name, and unknown keys are kept and left out of the approval hash rather than failing the load.
12. **One front-matter splitter.** `splitFrontmatter` and `splitFrontMatter` become one, with the looser grammar (`...` closes, trailing whitespace is fine), used everywhere.

## Left alone, on purpose

- **A topic stays an id everywhere**, in drafts included: a name breaks when its folder is renamed.
- **The record logs keep every key they have**, including `app`: a log read because something went wrong is where the build that wrote it matters.
- **`CHAT.md` stays a render.**
- **Message documents keep `message`, `kind`, `to`, `subject`, `via`.**
- **`SKILL.md`'s other keys** are the skills format's, not ours to rename.
