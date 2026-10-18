# The agent asks for folders and apps

## Context

[The agent works at real paths](2026-10-11-the-agent-works-at-real-paths.md) let the boundary ask: a call that ran into a folder that asks first, or an app the chat may not use, raised the card itself and told the agent in prose to end its turn.

For the shell's own commands and the file tools that is exact, since the filesystem wrapper knows the path and the operation. For a real program (`python`, `node`, `git`, the bundled uutils) the kernel sandbox refuses, and the app learned of it only by matching the program's output afterwards (`refusedPathIn`), and only when the program exited nonzero. A script that caught its own `Operation not permitted` and printed it exited 0, raised no card, and the agent told the person the folder was read-only for good. Under bubblewrap the same refusal reads as "no such file". And the turn ending was a request: an agent could keep working and raise more cards, or write its "I need access" line after the person had already answered.

## Decision

- **One tool puts up a permission card.** `ask_permission` takes a kind (`folder` or `app`), a target and a reason the card shows. It records the ask and returns at once, and the turn ends on the call in code (`shouldContinueAfterHandingOff`), with no step after it for a line.
- **The app decides what is asked for.** The folder is the one a refusal would name (`askableFolder`): one level below the place that asks, a sign-in folder whole, never the home folder, a disk or the app's own data. One already allowed answers so; one closed or declined says why.
- **Refusals raise nothing.** The shell's commands, the file tools, the uutils argument check and the app gates name what to ask for. A real program's own refusal reaches the agent as printed, and nothing reads it.
- **On macOS an Allow looks inside first.** The app lists the folder from its own process, which is when the system's Desktop or Documents prompt comes up, and wakes the askers only once that settles. A folder macOS refuses keeps its card, `macos-refused`, with the yes kept, until a retry after the system's folder panel or System Settings gets in or the person declines. Windows and Linux have no such grant and skip the look.
- **Apps go the same way.** Every route to a Mac app is one the app knows before it runs, so detection never guessed; the card moves to the tool for the same stopping point.

## Alternatives

- **Find the refusal in the sandbox's own record** (Seatbelt's violation log, MXC's denial capture). Rejected: still text read after the fact, late, and one dialect per platform, with nothing like it for bubblewrap.
- **Keep the boundary raising cards and add a note to a zero exit.** Rejected: it keeps the output matching it was meant to remove.
- **A bounded wait on the macOS look.** Rejected: the answer can come after any bound, and a timeout would lose it.
