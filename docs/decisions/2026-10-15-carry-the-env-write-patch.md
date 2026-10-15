# Carry just-bash's process.env write fix as a local patch

Date: 2026-10-15

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way the earlier `carry-the-*-patch` decisions do.

## Context

While any command runs on the main thread (`task`, `app`, `chat`, `memory`, `tab`, `agent-browser`, `jobs`, `fg`, `kill`), just-bash's defense layer swaps `process.env` for a proxy across the whole process. Its `set` trap forwards the proxy as the receiver, so assigning a variable that already exists becomes a value-only `defineProperty`, which Node refuses for `process.env`: "'process.env' only accepts a configurable, writable, and enumerable data descriptor". That happens to host code too, outside any script and inside `runTrusted` alike, so `runTrusted` is no way around it.

The Claude Agent SDK sets `process.env.CLAUDE_AGENT_SDK_VERSION` on every `query()`, so every Claude Code start in that window failed: a Claude account's cold step, a title or other one-off, the model list on a cache miss, usage, and sign-in. It read as an intermittent CLI failure. Upstream fixed the same throw for `DEBUG` alone in #269, narrowed to that key at the maintainer's request, so each library that sets its own variable hits it again.

## Decision

Carry one more part of `patches/just-bash@3.6.0.patch` until it is in a version we install: [vercel-labs/just-bash#598](https://github.com/vercel-labs/just-bash/pull/598) pinned at its head. On the path that does not block, it sets a `process.env` key on the real object when the receiver is the proxy itself, keeps the receiver for an object that inherits from `process.env`, and records the write as a violation in audit mode. Writes from the script itself still throw `SecurityViolationError`. `create-bash-env-env-write.test.ts` is the guard.

Changing the defense module renames its bundle chunk, and the rename reaches a chunk the patched `index.js` imports where the published one does not, so `scripts/rebuild-just-bash-patch.ts` also pairs a rebuilt file with the published file whose content it matches apart from the hashed names it imports, before pairing what is left by position.

## Alternatives

- An entry for `CLAUDE_AGENT_SDK_VERSION` beside upstream's `DEBUG`: rejected, since it fixes one library's key and leaves the next to fail the same way.
- Setting the variable before the shell starts, or wrapping each `query()` in `runTrusted`: rejected, since the SDK writes it inside every call and a trusted write takes the same failing path.
- Keeping Claude Code starts out of the window a main-thread command holds: rejected, since the window is any main-thread command in any chat, and the starts include work the user did not ask for at that moment (titles, the model list).
