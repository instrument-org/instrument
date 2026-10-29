# Architecture

Evergreen maps of the system: how a subsystem or domain is put together and how its pieces layer. This is the living "how it works today" reference, edited in place as the code changes rather than captured as a dated snapshot. One Markdown file per subsystem. Link the code paths a doc describes so it stays tied to the source, and link the `docs/decisions/` record that explains why the design is the way it is.

Nothing here carries a status or a date. If a statement stops being true, correct it where it stands — a dated caveat inside an evergreen doc is the shape this section exists to avoid.

## Index

- [system-overview.md](system-overview.md) — the top-level map: packages and layering, chats, tasks, and the app window, main-vs-renderer topology, on-disk layout, and how an agent turn flows end to end. **Start here.**
- [drafts.md](drafts.md): drafts of new chats and replies waiting in chats: the one writer of `Drafts/` in main, the ops windows send and the snapshots they get back, the folder changing under the app, and the three steps of a send.
- [chat-records.md](chat-records.md) — a chat as a folder of append-only logs: the files and who writes them, the one door in and the one door out, what a part still arriving is, the index over them, and the way in from a `chat.db`.
- [synced-stores.md](synced-stores.md): workspace state every device writes, such as the bookmarks, as one append-only file per device under `.instrument/devices/`: the line format, the newest-wins fold, the store's API, and how Studio's bookmarks sit on it.
- [ai-gateway.md](ai-gateway.md) — model access: the mounted provider-proxy Hono app, plus the model discovery and identity library that workspace and studio consume.
- [auth-callback-server.md](auth-callback-server.md) — loopback callback ownership, canonical paths, and assembled-router tests.
- [agent-sandbox.md](agent-sandbox.md) — how agent tools are held to the Permissions rules: path-scoped file I/O, the just-bash filesystem, the agent-browser allowlist, and the real-binary escape hatches under Seatbelt on macOS and bubblewrap on Linux.
- [bash-sandbox-mounts-and-native-binaries.md](bash-sandbox-mounts-and-native-binaries.md) — how the folders a chat reaches are mounted at their real paths, why a folder inside another is reached through the outer one, and the just-bash quirks that follow.
- [background-processes.md](background-processes.md): what happens to a `bash` command that outlives its wait: the promotion rule, the `jobs`/`fg`/`kill` commands, who owns a running process and what ends one, and the caps.
- [threat-model.md](threat-model.md): what the agent's limits protect, what they deliberately do not, and how to decide whether a security finding needs a fix. Read before reviewing or changing containment.
- [native-sandbox-off.md](native-sandbox-off.md): what it means when the agent's programs run without a sandbox on macOS or Linux, why it happens, and how the app decides and warns. Settings › Permissions links to it.
- [windows-sandbox.md](windows-sandbox.md): how MXC holds native commands on Windows, the canary that decides whether it can on a machine, what Settings says where it cannot, and what it leaves open.
- [native-and-builtin-commands.md](native-and-builtin-commands.md): which shell commands run as real programs and which as just-bash builtins, per platform, with the table of GNU text commands on uutils generated from the code, how a name is routed, and what the launcher and the OS sandbox do.
- [just-bash-upstream.md](just-bash-upstream.md) — which build we consume, every patch and agent-facing workaround we carry because of an upstream gap, and the removal trigger for each. Read before adding a prompt line that steers the agent around sandbox behavior.
- [in-app-browser.md](in-app-browser.md) — the in-app browser the user, a chat, and its tasks share: the renderer-owned `<webview>` pool, paint-host vs visible, the CDP path from `agent-browser` to the guest, what the panel may do that the agent may not, and how a file on the computer opens at one `file://` address for the person and the agent.
- [deep-links.md](deep-links.md): the `instrument://` links the app opens from outside, how each of the three roads in reaches the window, and what keeps a link from a hostile site harmless.
- [responsive-layout.md](responsive-layout.md) — why viewport breakpoints are the wrong proxy for layout width under UI zoom and a resizable sidebar, the `@container/app-content` shell container, and the unit rules for portalled content.
- [auto-updater.md](auto-updater.md) — how Studio finds, stages, and installs a build: the pure-reducer / port-seam / wiring split, channel selection, and why the build offered and the build installed can diverge.
- [releasing.md](releasing.md) — cutting a version, what the tag build produces, why the artifacts land in S3 rather than on the GitHub release, and why a build is live before its draft notes are published.
- [app-metadata.md](app-metadata.md) — the strings the OS shows about the app outside its window (installers, Get Info, file properties, package metadata, permission prompts), which field each comes from, and what moves when one changes.
- [mac-native-bridge.md](mac-native-bridge.md) — how Studio reaches macOS frameworks Electron does not: the in-process module for what macOS keys to the app (notification permission), the helper process for Calendar, Reminders, and Contacts, which half a capability belongs in, and how to add one.
