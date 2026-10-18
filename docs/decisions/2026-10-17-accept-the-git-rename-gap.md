# Accept that a program under MXC can rename `.git` to write its hooks

**Date:** 2026-10-17

A repository's hooks run outside every sandbox the next time the person uses git there, so a hooks folder in a folder the agent may change is closed to changes: Seatbelt denies writing it and unlinking `.git` on macOS, and bubblewrap binds each `.git` onto itself on Linux, so it can be neither changed nor moved. MXC, which holds the agent's programs on Windows, has no patterns and no mount points. The policy lists each existing hooks folder read-only, and a read-only entry holds a name, not the folder behind it: a program can rename `.git` aside, write a hook into the moved copy, and rename it back. The test PC showed exactly that on Windows 11 26200.9711.

## Decision

The gap is accepted, and nothing in the app tries to close it. It needs an agent that sets out, several steps deep, to plant code for later: rename a repository's `.git`, write a hook, put the folder back. An agent that does that is badly misaligned, which no folder rule is designed to survive, and the person's folder settings still decide which repositories it can reach at all. Every way to close it costs everyday git work in every chat on Windows.

The [threat model](../architecture/threat-model.md#what-we-do-not-protect) lists it with what Instrument does not protect, and among the findings not to fix.

## Rejected

- **Denying the rename.** MXC has no rule for a rename alone. Denying the folder holding `.git` refuses everything in the repository, and listing the parent's own name read-only holds that one name, which the same rename-and-return defeats one level up.
- **Making `.git` read-only.** Commits, fetches, branches and the index all write there, so every git command that changes anything would fail in an allowed folder.
- **Closing allowed repositories to native programs on Windows.** It would make git, and every build tool that reads a repository, unusable in the folders the person opened for exactly that work.

## Consequences

- A reviewer who finds the rename on Windows does not report it; [REVIEW.md](../../REVIEW.md) points here.
- If MXC gains a way to hold a folder by its contents rather than its name, or a rename rule, the policy generator should use it and this record should be superseded.
