# The names in a visible file's front matter

Status: proposed. The inventory is complete and checked against the code; every rename below is still a decision.

A person can open any of these files in a Markdown viewer, and another client (the phone app) has to author some of them. So the keys are a product surface: they are read by someone who has never seen the schema, and written by someone implementing against it. They should say what they hold without a legend.

There are four front-matter writers in the tree today (`CHAT.md`, `DRAFT.md`, a memory, the dev-only transcript export), two kinds the agent writes and we parse (`SKILL.md`, message documents), and the record logs' own header line. 97 distinct key names between them.

## The rule

Four questions, the same words everywhere:

- **What it is**: `title`, and the folder or file is named from it.
- **When**: `created` and `updated`. Not `started`, not `at`, not `createdAt`, not `sessionCreatedAt`.
- **What it belongs to**: `chat`, `topic`. The value names the thing the way the disk does: a chat by its record folder name (`2026-10-14-quiet-dishwashers`), a topic by its folder name (`Kitchen`). Never an internal id a person cannot see anywhere else.
- **Its own identity**: `id`, and only in a file the app has to find again after a person moves or renames it. A chat's id is a link in `CHAT.md`'s body instead, where it is also something to click.

Two consequences worth stating, because they settle most of the open questions on their own:

**Nothing is hidden from the person.** A key that cannot be written sensibly by another client is not a key that needs hiding; it is a key naming the wrong thing. The one value in `DRAFT.md` that looked like it needed a second file was a pointer into one window's tab list. Store what the thing is instead of which tab it is, and the whole file is open.

**A file is either a render or a source, and it says which by whether it has an `id`.** `CHAT.md` is a render: the app rewrites it whole and an edit does not last. `DRAFT.md`, a memory, a topic, a skill and an app are sources: they carry an `id`, the app finds them by it, and a key it does not recognize is kept.

## What a person sees

`Chats/<name>/CHAT.md`, a render:

```yaml
---
title: Quiet dishwashers under $900
created: 2026-10-14T12:00:00.000Z
topics:
  - Kitchen
---
```

`Drafts/<date>/DRAFT.md`, a source, with every key the app keeps for it:

```yaml
---
id: 01KFDRAFT0000000000000001
created: 2026-10-14T18:22:04.000Z
updated: 2026-10-14T18:25:11.000Z
chat: 2026-10-14-quiet-dishwashers
topic: Kitchen
attached:
  - kind: file
    path: dishwasher.png
    name: dishwasher.png
    mediaType: image/png
    size: 184320
openedOn:
  - /Users/sam/Documents/Kitchen plans
openedOver: 2026-10-14-quiet-dishwashers
leftOut:
  - screen
topicPickedBy: person
---
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
5. **A draft's `state` blob.** One line of JSON holding `chosen`, `included`, `leftOut` and `topicSource`, documented as holding "nothing a reader would have to decode". Its four keys move to the top level with names: `openedOn` (files and folders the person opened the draft on), `openedOver` (the thing on screen it was opened over), `leftOut` (chips the person took off), `topicPickedBy: person | app`. Note that `chosen` and `topicSource: "chosen"` are in there meaning two different things. Default: do it.
6. **What `openedOver` stores.** Today it can be `{group, tabId}`, a pointer into one window's tab list, which is the only thing in the file another client could not write and the reason a second file looked necessary. It becomes what the thing is: a chat by its id, a file or folder by its path, an app by its name. The window re-finds its own tab from that. Default: do it, and the second file is then not needed anywhere.
7. **`sendOn`.** Reads as a date; it holds the one device allowed to send the draft. Becomes `sendFrom`. Nothing sends yet, so this is the format only. Default: do it.
8. **Keeping what another client wrote.** A draft's parser lifts only the keys it knows and its writer emits only the keys it knows, so a round trip through the app deletes anything the phone added; saving a memory rewrites the file from three fields and drops the rest. Message documents already do this correctly, rewriting the one line that changed. Default: do it, both of them, since a format two clients write is the whole point.
9. **The transcript export.** `taskName` holds a *chat's* title, next to a `sessionTitle` holding a different title, in a product where a task is a specific other thing. `taskName` becomes `chat`, `sessionTitle` becomes `title`, `sessionCreatedAt` becomes `created`, `currentAppVersion` becomes `app`, `taskCreatedWithAppVersion` becomes `startedWithApp`. Dev-only, read by nothing. Default: do it.
10. **The record header's `title`.** It means "the title a task was started with", while a mark record with `field: "title"` means the chat's title now. Becomes `startedAs`. Default: do it.
11. **`mimeType` in `DraftRecord`.** Everything else in the product, including the draft file it is read from, says `mediaType`. Default: do it.
12. **`SKILL.md`'s allowed keys.** The validator warns on `argument-hint` and `context`, which the skill-creator skill we ship tells agents to preserve. Three more keys are allow-listed and parsed nowhere (`allowed-tools`, `license`, `metadata`). Default: allow the two the shipped skill asks for.
13. **Planned `APP.md`.** `baseUrl` for one kind of app and `url` for the other two becomes `url` throughout; `name` goes, since the folder is the name, the way the planned `TOPIC.md` already does it. And every manifest variant is a strict object today, so once it is front matter, one note key a person adds makes the app fail to load, uniquely among every file here. Unknown keys stay out of the approval hash instead. Default: do all three.
14. **The two splitters.** `splitFrontmatter` and `splitFrontMatter`, one capital letter apart, with different grammars: one accepts `...` as a closing fence and tolerates trailing whitespace, the other does not. Drafts and memories use one, the editor and the thumbnailer the other. Default: one of them, the looser grammar, used everywhere.

## Left alone, on purpose

- **A draft's `chat` stays an id.** It is what a reply is sent into, and a title is neither unique nor stable. The id is readable anyway (`2026-10-14-quiet-dishwashers`), so nothing is lost.
- **A draft's `id` keeps its bare ULID**, with no `drf_` prefix. Prefixes elsewhere are not worth changing a value another client already writes.
- **The record logs keep every key they have**, including `app`, which nothing reads: a log you are reading because something went wrong is exactly where you want to know which build wrote it. Their names are not a product surface.
- **`CHAT.md` stays a render.** An edit to it does not last, and that is the point: it is the chat shown as a file, not the chat.
- **Message documents keep `message`, `kind`, `to`, `subject`, `via`.** They are already the best-named and the only ones that round-trip.
