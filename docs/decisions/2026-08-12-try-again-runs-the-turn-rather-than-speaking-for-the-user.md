# Try again runs the turn again rather than speaking for the user

Date: 2026-08-12

## Decision

The Try again button on a failed turn asks the workspace to run the agent over the session as it stands. It adds nothing to the transcript.

`session.run` (`rpc/routes/session.ts`) sends `runTurn`, which reaches a live session actor or spawns one over the stored session with no queued message. The session machine finds the newest stored message, makes it the turn's boundary, and spawns the agent from there. What the agent answers is the request already in the transcript.

Paired with it, a request never ends with a failed attempt: `dropTrailingFailedMessages` removes the assistant messages at the tail that only recorded an error, so the retry sends what the first attempt sent.

## Why

The button used to send `"Try that again."` as a user message, because `addMessage` was the only way into the session machine. Three things followed from that:

- **The transcript claimed the user said something they never typed**, permanently, in exports as well as on screen, once per press.
- **"That" had no referent.** Before any assistant output it means the user's last request, which is right. Mid-turn it could mean the failed step, the whole turn, or the original task, and the expensive readings redo side effects: rewrite files, regenerate a billed image.
- **The failure usually was not the model's.** `rate-limit` and `transient` errors are already retried in the agent loop, so what reaches the button is a request that never landed. A resend does not need a sentence.

The rule about the tail is not only for this button. The in-loop retry rebuilds its request from the store too, so it was already sending the attempt that had just failed back as the opening of the reply it was asking for. A step cut off mid-sentence is nothing to build on, and providers that refuse a pre-written assistant turn while extended thinking is on reject the request outright rather than ignoring it.

Retrying against a quota-exhausted provider stacks three of those in a row (the loop spends its attempts), which is why the rule walks the tail rather than checking one message.

## Alternatives

- **Keep the message, word it better.** "Retry the request that failed; do not redo work that already succeeded" fixes the referent but not the attribution, and still spends context on a sentence that carries nothing.
- **Keep the message, mark it synthetic** so the transcript draws it as an action rather than as the user's words. Cheaper than a machine entry point, and the model still reads a sentence nobody said.
- **Delete the failed assistant message from the store and regenerate.** What most chat UIs mean by retry. Rejected: a failed turn can hold tool calls that already ran, and deleting the record does not undo what they wrote.

## Costs

The session machine grew a second way to start a turn, so `ProcessingQueuedMessages` now has two guards ahead of `Done` rather than one, and a queued message wins over a run request when both are set.

`session.run` will run over a session whose last message is a *successful* assistant message: the model is handed its own finished reply as the opening of a new one. Nothing in the UI does that today. Before anything does -- a play button that continues without a prompt is the obvious candidate -- the tail needs the same care the failed one gets: at minimum trailing whitespace trimmed from the last text part, which Anthropic rejects, and a decision about what a thinking model's reasoning parts mean in that position.
