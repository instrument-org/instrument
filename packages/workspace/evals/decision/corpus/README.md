# Decision eval corpus

Labeled cases for `pnpm eval:decision`. Indexes in the label files are positions in `chats.json`.

- `chats.json`: 376 real chat titles and opening asks (cut to 200 characters), newest first, with private names, places, identifiers and links replaced by invented ones. Chat search and topic backfill read these.
- `padding.json`: 624 invented chats on subjects none of the searches is about, so `chat-search-1000` asks about as many chats as the product does without changing what each search should find.
- `searches.json`: what a search should find (`must`) and what is fine to show without being counted as noise (`ok`).
- `backfill.json`: the same idea for a new topic over the newest 200 chats (`yes`, `ok`).
- `apps.json`: app directory searches by slug, against the catalog the product ships.
- `drafts.json`: opening messages and the topic each should be filed under, as `[text, topic or "none", acceptable alternates?]`, in two sets with their own topic lists.
- `settings.json`: the rows and skills settings search reads, and searches with the entry ids each should find.
- `emoji.json`: a topic and the emoji that fit it; a hit is any of them among the eight shown.
- `retitle.json`: invented chats with a fitting title; `drifted` marks the ones whose reply moved off it. Each is also asked against another chat's title, which has moved by construction.

Labels were made by hand by reading every candidate. When a model offers something unlabeled that a person would also accept, add it to `ok` rather than tuning around it.
