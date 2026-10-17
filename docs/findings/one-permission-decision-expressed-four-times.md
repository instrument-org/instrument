# One permission decision, expressed four times

**Status:** open. The storage is sound; the cost is in how many places the same answer is derived. Written 2026-10-16 while deciding whether to rework the permissions files, and the answer to that narrower question was no.

## Where the weight is

```
permissions/rules.ts         668    builds the rule list and ranks the sources
permissions/rules-fs.ts      280    the fs proxy that refuses and raises the card
permissions/places.ts        260    the built-in places
permissions/apps.ts          174    Mac apps
permissions/chat-rules.ts    137    a chat's grants as rules
chat/folder-reach.ts         143    which folders a chat mounts
chat/grants.ts               105    writing a grant

native-sandbox/seatbelt.ts   370    the same rules, as a Seatbelt profile
native-sandbox/bwrap.ts      465    the same rules, as bubblewrap arguments
native-sandbox/mxc.ts        488    the same rules, as a Windows MXC policy
```

No single file is wrong. One question, "may this chat read or change this path", is answered once by our rules and then again in three sandbox dialects that have to agree with it exactly. A disagreement between them is invisible until an agent is refused by one layer and allowed by another, and which layer it meets depends on whether it ran a builtin or a real program.

## The part that is genuinely backwards

A builtin goes through `ruleRefusal`, which asks `reachOf` and raises the card.

A native program is stopped by the sandbox first. `native-sandbox/refusals.ts:140` then parses the program's own error text, `EROFS` or `cannot create directory`, back into a rule decision so the same card can be raised. The answer was available before the program ran, and it is being reconstructed from the program's complaint afterwards.

That is the piece worth changing: the native path should ask the rules directly rather than infer them from stderr. Everything downstream, the card, the note the model reads, the refusal vocabulary, is already shared.

## What is not worth changing

The files on disk. `permissions.json` is in the machine folder, which is correct, since every path in it is this computer's and a workspace synced to a second machine would otherwise arrive carrying grants to folders that do not exist there. The shape matches what the rules need. Arrays of records with a `level`, rather than maps keyed by path or by app name: a path makes a poor key, and a record leaves somewhere to keep a bundle id.

The timestamps stay. `grantedAt`, `deniedAt` and `addedAt` are read by nothing today, and they are the data an audit trail needs: when a folder was allowed, when something was refused, and whether a grant came from a card or from an attachment. Thirty bytes against a feature we will want.

## The one fix worth making now

`ChatPermissionsSchema`'s fallback sits on the chat, so one unreadable value in one grant drops that chat's `grants`, `appGrants` and `denials` together. Move the fallback down to the record: a bad record is dropped on its own and the rest survive.

This is better than making the unread fields optional, which was the first idea: it keeps the types strict and gives a smaller blast radius. `permissions.json` is the sandbox's own allowlist and the one file here where a hand edit is a privilege change rather than a cosmetic one, so it is also the one most likely to be edited by someone poking at it.

## Also true

The grant, app-grant and denial schemas are declared twice, in `permissions/rules.ts` and in the schema file. Keep the rules one and repoint the two importers.

Matching is already correct across systems: case-insensitive on macOS and Windows, case-sensitive on Linux, a path on the Mac's data volume matched the way the rest of the system spells it, and a Windows name ending in dots or spaces matched without them. Seatbelt needs none of it, since it matches the path the kernel resolved.
