# A converted message is the read of its row, not the row

**Status:** open, and measured as costing nothing on the install this converter exists for. The decision is whether to close it before the set-aside databases are ever deleted.

The conversion writes a part as **the row `chat.db` held** and a message as **the read of its row**. `partRecord` says why it does it that way, in its own comment: "the row rather than the read of it, because a read stands in for whatever it cannot make sense of". Messages get no such treatment — `logRecords` pushes `{ t: "message", at, message }` with the parsed value, and `readChatDb` never keeps the raw row for a message (`ChatDbPart` has a `stored` field; `ChatDbMessage` does not).

Two consequences follow, and the second is the reason this is written down:

1. Anything `SessionMessage.Schema` drops is not in the record. The metadata schemas are plain `z.object`s, so a key they no longer list is stripped; `usage`, `aiGatewayModel` and `aiGatewayModelServed` are `.catch(undefined)`, so a shape they no longer accept becomes nothing; `finishReason` is `.catch("unknown")`, so an unknown value is rewritten rather than dropped.
2. **The field-by-field verification cannot see it.** `verify` compares the same parsed object with the fold's read of that object, so both sides are identical by construction and report no difference. The conversion then says the records hold everything the database held, and the launch moves `chat.db` out of the workspace into `set-aside/chat-db/`.

## What it actually costs here, measured

The obvious candidate is `usage`: `UsageSchema` requires the nested `inputTokenDetails` and `outputTokenDetails`, which arrived with the image-generation spike (`d51060fc0`, 2026-01-29). Before that the shape was flat, so a message written earlier should parse to `usage: undefined` and lose its token counts silently.

It does not happen on this install. Reading every `chat.db` and `task.db` in the real workspace read-only, over the raw JSON rather than through the schema:

| | |
|---|---|
| Databases with messages | 817 |
| Assistant messages | 7,971 |
| `usage` in the nested shape | 6,958 |
| `usage` absent from the row | 1,013 |
| `usage` in the flat shape | **0** |
| Oldest nested `usage` | 2026-04-15 |

So the corpus does not reach back past the schema change with usage attached, and the named instance is free. The 1,013 without usage have no usage in the row either — this is measured on the stored JSON, so it is not a parse failure being counted as absence.

## Why it is still worth a decision

What is left is a latent hole rather than a loss: the next change that narrows a message-metadata schema loses that field on every chat converted afterwards, and the comparison that exists to catch exactly this will say the chats are the same. The protection parts already have is the protection messages lack, for no stated reason.

Closing it means carrying the raw row on `ChatDbMessage` the way `ChatDbPart` carries `stored`, writing that in `logRecords`, and comparing row against line in `verify` the way `addPartLines` does for parts. That is a change to a converter whose acceptance run has passed over 392 real chats, so it is worth doing deliberately rather than alongside other work.

The mitigation that exists today: `set-aside/chat-db/<chat>.db` keeps every converted database, so anything dropped is still recoverable. The plan calls deleting those "a later release's call" — **that** is the moment this has to be closed, because it is the moment the data stops being recoverable.
