# Importing chats from other AI apps

Status: built. Sources, writer, `chatImport` RPC, `instrument import` and the picker in Settings > Memory work end to end on Claude Code, Codex and a synthetic ChatGPT export. Open: a real ChatGPT and Claude export, a real Cursor install, and a run of the `chat-import` eval case.

## What it is

A person brings the chats they had elsewhere into Instrument, picking which ones. Memory import already brings in what another AI knows about them; this brings in the conversations themselves, which they can read, search through `$INSTRUMENT_CHATS`, and continue.

## Where chats come from

Only files the person already has. Nothing signs in to another service or reads its private endpoints: all three big services forbid automated access to their consumer apps in their terms, and the endpoints change without notice.

- **Coding agents on this computer:** Claude Code (`~/.claude/projects/**/*.jsonl`), Codex (`~/.codex/sessions/**/rollout-*.jsonl`), Cursor (`state.vscdb`, read-only SQLite). Hidden folders in home, which macOS does not put behind a consent prompt.
- **Export zips:** ChatGPT (Settings > Data controls > Export) and Claude (Settings > Privacy > Export data). Each service emails a link that expires in a day. The person asks for the export themselves, in the app's browser if they like, then drops the zip in.
- **Not sources:** the ChatGPT Mac app's cache (encrypted with a Keychain key), the Claude desktop app (claude.ai in a window, nothing local), Gemini's Takeout (an activity log, often blank).

## How it is built

- **Deterministic parsers, one per source**, behind `ChatSource`: `list()` for the picker, `read(ids)` for the import. They take an unknown field as optional and a shape they do not know as a chat to skip, not an import to fail: ChatGPT's export changed shape in 2026 and every open-source importer broke on it.
- **One branch per chat.** ChatGPT keeps edits and regenerations as a tree; the import follows the branch from `current_node` back to the root, the one the person last saw.
- **Text only, honestly.** Messages come across as their words. Tool calls, images and files do not, and the message says what it had (`omitted`), so the chat does not pretend to be whole.
- **Original dates.** Every record is dated when the source wrote it, so an imported chat sorts by when it happened and three hundred of them land below this week's chats rather than on top.
- **Provenance in the header.** The session header names `imported: { kind, sourceId }`. Listing again marks what is already here, and importing again skips it.
- **Staged writes.** A chat is written whole before it is listed, the way the chat.db converter stages, so a run cut off leaves no half chat.
- **The agent drives, the parser decides.** `instrument import` lets a chat list sources, list or search their chats and bring some in, so "bring in my kitchen remodel chats from ChatGPT" works in conversation. What lands is what the files said.

## Decisions

- The picker leaves out what a source made on its own (subagent runs, sessions with no reply) by default, and shows the count.
- Imported chats keep no model setting, so continuing one uses the person's default model.
- Not archived, not filed under a topic: their dates already keep them out of the way.
