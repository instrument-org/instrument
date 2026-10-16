# The names in a visible file's front matter

Status: proposed. The inventory is complete and checked against the code; every rename below is still a decision.

A person can open any of these files in a Markdown viewer, and another client (the phone app) has to author some of them. So the keys are a product surface: they are read by someone who has never seen the schema, and written by someone implementing against it. They should say what they hold without a legend.

There are four front-matter writers in the tree today (`CHAT.md`, `DRAFT.md`, a memory, the dev-only transcript export), two kinds the agent writes and we parse (`SKILL.md`, message documents), and the record logs' own header line. 97 distinct key names between them.

## The rule

Four questions, the same words everywhere:

- **What it is**: `title`, and the folder or file is named from it.
- **When**: `created` and `updated`. Not `started`, not `at`, not `createdAt`, not `sessionCreatedAt`. Written as `2026-10-14 18:22:04` in every file a person opens: local time, no `T`, no `Z`, no milliseconds, so the number matches the clock they were looking at. The logs keep full precision, since no person reads one.
- **What it belongs to**: `chat`, `topic`. The value names the thing the way the disk does: a chat by its record folder name (`2026-10-14-quiet-dishwashers`), a topic by its folder name (`Kitchen`). Never an internal id a person cannot see anywhere else.
- **Its own identity**: `id`, and only in a file the app has to find again after a person moves or renames it. A chat's id is a link in `CHAT.md`'s body instead, where it is also something to click.

Two consequences worth stating, because they settle most of the open questions on their own:

**Nothing is hidden from the person.** A key that cannot be written sensibly by another client is not a key that needs hiding; it is a key naming the wrong thing. The one value in `DRAFT.md` that looked like it needed a second file was a pointer into one window's tab list. Store what the thing is instead of which tab it is, and the whole file is open.

**A file is either a render or a source, and it says which by whether it has an `id`.** `CHAT.md` is a render: the app rewrites it whole and an edit does not last. `DRAFT.md`, a memory, a topic, a skill and an app are sources: they carry an `id`, the app finds them by it, and a key it does not recognize is kept.

## What a person sees

`Chats/<name>/CHAT.md`, a render. The deep link is the first line of the body rather than a key, so it is something to click, and it is what lets a folder renamed in Finder be found again:

```markdown
---
title: Quiet dishwashers under $900
created: 2026-10-14 13:00
topics:
  - Kitchen
---

[Open this chat in Instrument](instrument://chat/2026-10-14-quiet-dishwashers)

## Find a quiet dishwasher…
```

`topics` is a list only while a chat can be under several. The file is a render, so the day that becomes one topic, it becomes `topic` with no migration to write.

`Drafts/<date>/DRAFT.md`, a source, with every key the app keeps for it:

```yaml
---
created: 2026-10-14 18:22:04
updated: 2026-10-14 18:25:11
chat: 2026-10-14-quiet-dishwashers
topic: Kitchen
model: openai/gpt-6.1-sol?provider=chatgpt-account
context:
  - dishwasher.png
  - /Users/sam/Documents/Kitchen plans
  - instrument://chat/2026-10-14-quiet-dishwashers
---
```

`model` is the model the draft will run on when it is sent, which is a choice made while composing and so belongs with the words rather than with the chat. At Send it becomes the chat's `model`, in `settings.<device>.jsonl`. It is the one key a reply draft written on a phone needs that a chat already has.

`context` is everything that goes with the message: a file, a folder, or a chat written as the link `CHAT.md` already uses. The app fills it once, when the draft is made, from the chips it would have shown. After that it is a list, and taking a chip off takes its line out of the file. Nothing is re-derived on open, so no key has to record a no: a no is a line that is not there.

Every one of those is optional, which is the test the format is held to: a person can write a draft by hand, in any editor, and the app picks it up.

```markdown
---
topic: Kitchen
---
Remind me to call the plumber about the leak
```

A memory:

```yaml
---
chat: Roofer call
updated: 2026-10-16T18:04:11.231Z
---
```

## Numbered decisions

Each one is a rename, and each stands alone: take any of them without the rest.

1. **Dates.** `created` and `updated` in every file a person opens. `CHAT.md`'s `started` becomes `created`; a memory's `at` becomes `updated`, which is what it has always meant. The record logs keep `at` and `createdAt`, since nobody reads those by hand. Default: do it.
2. **A chat's own title in `CHAT.md`.** It has none today, so a Markdown viewer's properties panel and the file thumbnail both label a chat with nothing, while a dev-only transcript labels itself. It also means the title survives the person moving the folder. Default: do it.
3. **A memory's `from`.** `from: "Roofer call"` reads as a sender in a product where `to:` is a message recipient, and the `chat:` under it holds a *session* id, which is the only place in any visible file where `chat` means something other than a chat. Both become one key: `chat: Roofer call`, the title. The session id is read by nothing but the grouping in Settings, which the title and the date already do. Default: do it.
4. **A draft's `topic`.** `topic: "top_01K8…"` today, in the one file another client has to author, naming a ULID that appears on no surface anywhere. It becomes the topic's name, which is what its folder is called and therefore what identifies it. Default: do it.
5. **`attached`, `state` and the four keys in it, all become `context`.** The blob is one line of JSON holding `chosen`, `included`, `leftOut` and `topicSource`, documented as holding "nothing a reader would have to decode", in which `chosen` and `topicSource: "chosen"` mean two different things. All of it is one question, what goes with the message, so it is one list. `topicSource` is the exception and simply goes: write `topic` only when the person picks one, and its presence is the answer. Default: do it, and no second file is needed anywhere.
6. **What a line in `context` looks like.** Attachments carry five fields each today (`path`, `kind`, `name`, `mediaType`, `size`), of which four are read off the file itself and nothing computes with. One line each: a relative path inside the draft's folder, an absolute path anywhere, or an `instrument://chat/<id>` link. The message record keeps all five, because a record keeps what was true and a draft points at what is there. Default: do it.
7. **A draft's `id`, and sending.** A ULID is a timestamp with noise after it, so `id` and `created` carry the same fact, and the one job only an id did (telling two conflict copies apart inside one folder) `created` does to the millisecond in something a person can read. `send` and `sendOn` are read by nothing and nothing sends yet. All three go. Default: do it.
8. **Keeping what another client wrote.** A draft's parser lifts only the keys it knows and its writer emits only the keys it knows, so a round trip through the app deletes anything the phone added; saving a memory rewrites the file from three fields and drops the rest. Message documents already do this correctly, rewriting the one line that changed. Default: do it, both of them, since a format two clients write is the whole point.
9. **The transcript export.** `taskName` holds a *chat's* title, next to a `sessionTitle` holding a different title, in a product where a task is a specific other thing. `taskName` becomes `chat`, `sessionTitle` becomes `title`, `sessionCreatedAt` becomes `created`, `currentAppVersion` becomes `app`, `taskCreatedWithAppVersion` becomes `startedWithApp`. It is dev-only but it is not read by nothing: `transcript-digest` reads `taskName`, `currentAppVersion`, `modelsUsed`, `activeDurationMs`, `toolCallCount`, `usage`, `sessionId` and `transcriptGeneratedAt`, `transcript-view` reads `taskName` and `usage`, and `TITLE_KEYS` in `shared/front-matter.ts` matches `taskName` and `sessionTitle`. None of that is type-checked against the writer, so each rename lands with its readers or it breaks them silently. Default: do it, readers included.
10. **The record header's `title`.** It means "the title a task was started with", while a mark record with `field: "title"` means the chat's title now. Becomes `startedAs`. Default: do it.
11. **`mimeType` in `DraftRecord`.** Everything else in the product, including the draft file it is read from, says `mediaType`. Default: do it.
12. **`SKILL.md`'s allowed keys.** The validator warns on `argument-hint` and `context`, which the skill-creator skill we ship tells agents to preserve. Three more keys are allow-listed and parsed nowhere (`allowed-tools`, `license`, `metadata`). Default: allow the two the shipped skill asks for.
13. **Planned `APP.md`.** `baseUrl` for one kind of app and `url` for the other two becomes `url` throughout; `name` goes, since the folder is the name, the way the planned `TOPIC.md` already does it. And every manifest variant is a strict object today, so once it is front matter, one note key a person adds makes the app fail to load, uniquely among every file here. Unknown keys stay out of the approval hash instead. Default: do all three.
14. **The two splitters.** `splitFrontmatter` and `splitFrontMatter`, one capital letter apart, with different grammars: one accepts `...` as a closing fence and tolerates trailing whitespace, the other does not. Drafts and memories use one, the editor and the thumbnailer the other. Default: one of them, the looser grammar, used everywhere.

## The other files in capitals

The same question of each: would a person reading it know what every key means, and could they change one without breaking something they could not have known about.

**`CHAT.md`** holds `title`, `created` and `topics`. All readable, none editable, because it is a render and the app rewrites it whole. `created` overlaps the folder's date and is kept for the time of day. Nothing else belongs in it: a chat's truth is its records under `.instrument/chats/<id>/`, and this file is that shown as Markdown, so there is no sidecar beside it and nothing here is read back.

**`TOPIC.md`** holds `id`, `emoji`, `color`, `about`, `created`, and `retired` only when true. The middle three are what a person would change, and changing them is safe; setting `retired` by hand hides a topic, which is a fair thing to find out. `id` has to stay, for a reason drafts do not share: a chat's marks point at a topic by id, so a topic folder renamed in Finder keeps its chats, and without the id a rename empties the topic. Dropping `name` and moving the granted folders out to a permissions file are both right: the folder is the name, and a grant should not widen by editing a document.

**`APP.md`** can hold the whole manifest in the open. No credential ever appears in one: `auth` names how a stored credential is attached to a request, the value lives in the credential store keyed by the app's slug, and the headers are documented as non-secret. It is also the file where editing by hand is most useful, since fixing a broken local server means changing `package`, `args` or `runtime`. Three fixes first: `baseUrl` becomes `url`, `name` goes, and the schema stops refusing unknown keys.

**`SKILL.md`** is not ours to name. Skills come from the registry and from third-party folders, so renaming `description` or `name` would orphan every skill written against the format. The only decision is the allow-list.

## Left alone, on purpose

- **A draft's `chat` stays an id.** It is what a reply is sent into, and a title is neither unique nor stable. The id is readable anyway (`2026-10-14-quiet-dishwashers`), so nothing is lost.
- **The record logs keep every key they have**, including `app`, which nothing reads: a log you are reading because something went wrong is exactly where you want to know which build wrote it. Their names are not a product surface.
- **`CHAT.md` stays a render.** An edit to it does not last, and that is the point: it is the chat shown as a file, not the chat.
- **Message documents keep `message`, `kind`, `to`, `subject`, `via`.** They are already the best-named and the only ones that round-trip.
