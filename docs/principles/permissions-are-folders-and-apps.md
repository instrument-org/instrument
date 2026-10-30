# Permissions are folders and apps

A person grants two kinds of things: folders and apps. Nothing finer. A capability that cannot fit one of those two is reshaped or given up, not given its own permission scheme. And Instrument never asks for, or steers anyone toward, Full Disk Access: a missing Full Disk Access is the permanent state on every Mac, and the product is designed around it.

**Applies when:** adding a capability that reaches outside the chat's folders, deciding how a card asks, or proposing a fix that would be easier with broader system access.

- Finder and System Events are apps like any other, whose grant happens to reach every file.
- When free-form scripting of other apps could not be held to the app grant, it was removed and replaced with fixed commands per app rather than a new permission level.
- A fix that only works with Full Disk Access is not offered, even as an option. Probe as the signed app: a dev build inherits the terminal's access and hides this.
- No approval per tool call. A card asks for a folder or an app, never for one command, which a person could not judge.
- A folder is allowed, asked about, or not allowed. There is no separate read-only mode, which was a nightmare to explain.
- Grants belong to the computer they were given on and do not sync.
- A grant given in a chat outlasts a later Settings change around it.

**Not:** a ban on asking. The agent asks for a folder or an app whenever it needs one, so it never gets stuck.

**Sources:**
- [The agent asks for folders and apps](../decisions/2026-10-18-the-agent-asks-for-folders-and-apps.md) (2026-10-18).
- [The agent works at real paths](../decisions/2026-10-11-the-agent-works-at-real-paths.md) (2026-10-11).
- Mac app scripting: kept as a feature (2026-10-02), Apple Events denied in the sandbox (2026-10-11), free-form AppleScript removed for fixed `mail`, `notes`, `messages` commands (2026-10-14). See [Mac native bridge](../architecture/mac-native-bridge.md).
- Never Full Disk Access, stated as a hard line 2026-10-18.
- No read-only mode, and the agent can always ask, stated 2026-10-08; no per-call approvals, 2026-10-28.
- [A chat's grant outlasts a later change in Settings](../decisions/2026-10-20-a-chat-grant-outlasts-a-settings-change.md) (2026-10-20).
