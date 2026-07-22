# Git without the user's credentials

## Context

The agent needs git for the work users ask for: pull down a repository, read its history, branch, commit. dugite has stayed a dependency since the `run_git_commands` tool was removed for exactly this reason, so the binary was already available.

Every path to authenticated git is a path to the user's own credentials. Git reads `~/.gitconfig` for credential helpers, `~/.git-credentials` for stored tokens, and defers to ssh-agent and `~/.ssh` for ssh remotes. There is no GitHub OAuth in Studio to borrow from. So "let the agent clone and push" and "don't hand the agent the user's credentials" cannot both hold today.

## Decision

Git runs against a configuration isolated from the user's, and gets no credentials at all. Public clone and fetch over http(s), plus local branching and committing, work. Private repositories and pushing do not: they fail fast with git's own message rather than blocking on a prompt.

`GIT_ALLOW_PROTOCOL=http:https` carries most of the weight. When it is set, it is the only transport check git makes, so it cannot be widened by config the agent supplies. It also removes ssh (and with it the user's keys) from reach, and closes the `ext::` remote-helper and `file://` transports as a side effect.

Commits are authored as the agent, never the user.

## Consequences

The agent will hit a wall on any private repository, and its error is git's "could not read Username ... terminal prompts disabled". That is the intended shape: an honest failure, not a hang and not a silent fallback to whatever the user's machine happens to have configured.

This is not a new security boundary. The `tsx`/`node`/`python` hatches already inherit the full main-process environment, `HOME` is the user's real home, and `<userData>/bin` (which holds a `git` symlink for the user's own apps) is on their `PATH`. A script can read `~/.git-credentials` directly. Adding the shim changes what is convenient, not what is possible. The controls exist so the common path is the safe one, not because git was the last thing holding the sandbox shut.

What the controls are worth is that git makes the unsafe path _trivial_ in a way plain file access does not: `git config credential.helper store` followed by `git credential fill` prints the user's GitHub token, and `git -C .. -C .. -C ..` walks out of the task while looking like it stays inside. Both were live in the first version of this change and are covered by tests now. The lesson worth keeping: git's config surface is large enough that an argv denylist alone will keep losing. The env layer that deletes every unowned `GIT_*`, and the forced `-c` entries that outrank config files, are what actually hold.

Two options remain open if authenticated git becomes worth it, in rough order of preference: a Studio-managed token scoped to one host and injected through a credential helper, or forwarding `SSH_AUTH_SOCK`. The second grants whatever every one of the user's keys can reach, including force-push, and should not be adopted without a deliberate second look.

## Implementation

- [Git shell command](../../packages/workspace/src/lib/shell-commands/git.ts)
- [Agent sandbox architecture](../architecture/agent-sandbox.md)
