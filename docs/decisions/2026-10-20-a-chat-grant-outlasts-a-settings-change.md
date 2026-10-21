# A chat's grant outlasts a later change in Settings

**Date:** 2026-10-20

A folder the person allowed in a chat stays reachable by that chat when Settings later marks a folder around it Not allowed. At the same depth a grant ranks above a Settings folder rule (`permissions/rules.ts`), and that order is the intended one: Settings is the standing default for every chat, and a chat's grant is a specific answer the person gave in that chat, which a later change to the default does not take back.

## Why

A grant is given in context, for the work in front of the person, by pressing Allow on a card the chat raised. Having a Settings change reach into chats that already have their answer would undo that answer without the person seeing it happen in the chat it affects, which is the surprising outcome. Settings decides what a chat may reach until the person says otherwise in it.

## Rejected

- **Settings wins over every grant**, which a review raised more than once: it makes Not allowed the final word, at the cost of silently revoking what a chat was told it could use.
