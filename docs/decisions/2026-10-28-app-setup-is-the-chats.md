# Apps are set up, connected and changed from the chat, and a task names what it needs

Date: 2026-10-28

## Context

A chat and the tasks it forks share one prompt and one tool list ([one agent that forks](2026-10-07-one-agent-that-forks.md)), and the chat owns what is in front of the person, their memories and the other tasks ([the window command](2026-10-27-the-window-command-and-one-tab-id.md)). Apps are the workspace's: a folder under `Apps/` and a connection record that every chat reads.

A task could write and change apps but could not ask for a sign-in. `instrument app new`, `new --force`, `test`, `guide` (written), `icon`, `account` (named) and `disconnect` ran from a task with no role check, so a background task nobody watched could replace a connected app's manifest (which then has to pass `test` again), take its key or sign-in away, or rewrite the guide every chat reads. `connect_app` was refused in a task, which was told to end with a needs fence naming the app. Every sign-in follows an app's folder being written (`connect_app` asks only for an app already in `Apps/`), so the one actor that wrote the app was the one that could not finish connecting it. Text a task received from `app new`, `app guide`, `app disconnect`, `app catalog`, `ask_permission` and the failures of `app call` and `app request` told it to "ask with connect_app", which it could not call, and the task's start note told it to ask for "an app on this computer" with `ask_permission`, which refuses the Mac's apps in Apps and points at `connect_app`.

## Options weighed

- **Tasks set apps up end to end.** A task writes the app and raises the sign-in card above the reply box, as a folder card. One round trip less, but a background task changes apps every chat uses, out of the person's sight, and a sign-in card arrives from work the person did not watch start.
- **App setup is the chat's.** A task uses only apps already connected; when it needs one set up, connected or changed, it ends on a needs fence, the chat does it (with the sign-in on its own card, in the conversation), and sends the task on. One extra hop through the chat, and apps change only where the person is looking.
- **Leave it.** Tasks keep writing apps and keep being refused the sign-in; only the wording is fixed.

## Decision

App setup is the chat's.

- `app new` (with or without `--force`), `app test`, `app icon` and `app disconnect` are `roles: ["chat"]`. `app guide` and `app account` refuse only their writes, at the point they write, so a task still reads a guide and the account an app names. `app catalog` and `app list` stay open to a task.
- The refusal: "only the chat sets up and changes apps, since every chat uses them. End your last message with a needs fence naming the app and what it needs (set up, connected, or changed); the chat does it and sends you on."
- No text a task receives names a tool or command its role cannot run. A task's `app catalog` says the service is set up "by the chat, named in your needs fence" in place of the set-up line. A task's `app call`, `tools` and `request` say in plain words what an app lacks (set up, connected, a key, a sign-in, a go-ahead to run, a move to the web) and point at the needs fence; the chat keeps `connect_app`, `app test` and the web road in the same failures. `ask_permission` on one of the Mac's apps in Apps tells a task to hand it on. The task's start note says apps are set up, connected and changed only from the conversation.
- The chat's note for a task waiting on it says an app it needs is the chat's to set up and connect with `connect_app`, and that once the note says it is connected, `task send` moves the task on rather than the chat doing the work itself.
- The shared prompt stays role-neutral: its role line lists setting up or changing an app among the chat's, and its needs line says "an app to set up, connect or change". The tool definitions are unchanged.

## Consequences

- A task that meets an app it cannot use costs one hop through the chat before it goes on.
- A task can still write an app's `APP.md` with its file tools; nothing at the capability layer stops that. The task's start note and the refusal are what keep it to the needs fence.
- Inline cards (`choose`, `connect_app`) are raised by the chat in the conversation; the cards above the reply box (folders, the Mac's apps, macOS's own answer) are consent any session can raise.
