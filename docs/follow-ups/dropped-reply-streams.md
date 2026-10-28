**Status:** open · **Check after:** 2026-11-11, after a week on a beta with the cause capture · **Last checked:** never

# Why reply streams drop partway

## What we're waiting to learn

How often a model's reply stops partway because the connection carrying it broke, and where it breaks. A tester's report showed a reply cut off after a few words with "Failed to process successful response" (status 200), retried, and answered in full. The API's logs had the cut-off request finishing normally and the provider billing the whole generation, so the stream broke after it left the API: on the network to the computer or inside the app. The transcript kept only the SDK's message, which names the step that failed, not what failed under it.

The commit that adds this file keeps the error's cause chain on the message (`cause`, shown under developer mode's Details) and reports every `APICallError` that has both a status and a cause: a response that arrived and then could not be read. A provider's own refusal has no cause, and a request that never connected has no status, so neither is reported.

## The signal

Exceptions with area `llm-request` whose message is "Failed to process successful response", grouped by the cause:

- **`TypeError: terminated, caused by SocketError: other side closed (UND_ERR_SOCKET)`**: the far end closed the connection partway through the body. Reproduced locally by dropping the upstream socket behind the app's own proxy.
- **A body timeout (`BodyTimeoutError`, `UND_ERR_BODY_TIMEOUT`)**: the stream stalled until undici gave up, rather than closing.
- **A parse or validation error**: the body arrived whole but did not match the shape the provider SDK expects, which is a provider or SDK change rather than the network.
- **No events at all after a week of chats**: drops are rare enough that the retry is the whole answer.

## Where to look

PostHog error tracking for the desktop app, filtered to area `llm-request`. The event's data carries the classification, and its properties carry the model, provider and app version. For a sighting worth tracing, the API's Workers Logs for the same minute and session show whether the API finished the request (`outcome: ok`) and which Cloudflare location served it.

## What each answer means

- **Socket closes scattered across users, providers and networks:** ordinary network loss. Keep the retry, and make the cut-off reply disappear when its retry succeeds, since the fragment above the full answer is what the person sees.
- **Socket closes concentrated on one provider, model or Cloudflare location:** an upstream or routing problem. Take it to that provider, or look at where Cloudflare serves those requests from.
- **Body timeouts:** a provider holding a stream open without sending. Compare against the chunk timeout the request already has.
- **Parse errors:** a provider changed its stream shape. Pin or patch the provider SDK.

## Result
