**Status:** open · **Check after:** 2026-11-13, after a week on a beta with the stream guard · **Last checked:** never

# Why Responses streams end without a terminal event

## What we're waiting to learn

How often a Responses API stream closes without `response.completed`, `response.incomplete`, `response.failed` or `error`, on which providers, how far it got, and whether one retry is enough. A task on a ChatGPT account got `response.created` and then a body that closed cleanly a fraction of a second later. `@ai-sdk/openai` read that as a finish with reason `other` and no usage, so the task's receipt said it was stopped, as if someone had stopped it. The other reading, a terminal event under a name the SDK does not know and drops, was never ruled out.

The commit that adds this file puts every streamed Responses request through the gateway's stream guard, which retries once when the stream closed with only lifecycle events, ends it with an error otherwise, and reports each occurrence.

## The signal

An exception reported from area `ai-gateway` with the message "Responses stream ended without a terminal event", the same line in the main-process log as a warning prefixed `[ai-gateway]`. Its data carries `provider`, `path`, `first` (the first attempt's distinct event types, the last few, whether output had begun, and `unreadByClient`, the types the SDK ignores), `retry` (absent when output had begun; otherwise `completed`, `ended-early`, `refused` with `retryStatus`, `failed` or `canceled`) and `second` (the retry's events, when it also ended early).

- **`retry: completed`, `first.lastEventTypes` ending at `response.created` or `response.in_progress`**: the case first seen, and the retry is the fix.
- **`retry: ended-early`**: a provider that keeps closing early on the same request; the person sees "Reply was cut off" after the workspace's own retries.
- **No `retry`, `first.outputBegan: true`**: a stream that closed partway through its output. The workspace retries the step as a transient error.
- **A non-empty `unreadByClient`**: a type the SDK drops. One that looks terminal (`response.done`, say) confirms the other reading.
- **None of these after a week of chats**: rare enough that the guard is the whole answer.

## Where to look

The app's exception reports and main-process logs on the computers running the beta, filtered to the message above.

## What each answer means

- **Mostly `retry: completed`:** keep the guard as it is.
- **Frequent `retry: ended-early`, one provider:** take it to that provider, and consider a short wait before the retry.
- **Frequent closes after output began:** consider resuming rather than restarting the step, since the workspace's retry writes the reply again from the start.
- **A terminal event under an unknown name:** treat it as terminal in the guard, and patch or upgrade `@ai-sdk/openai` to read it.

## Result
