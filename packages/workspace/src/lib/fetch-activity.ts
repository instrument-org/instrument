type Fetch = typeof globalThis.fetch;

/** How often bytes arriving may count as activity, at most. */
const ACTIVITY_INTERVAL_MS = 1000;

/**
 * A fetch that calls `onActivity` as a response's body arrives, at most once
 * a second.
 *
 * A request waiting in a provider's queue streams keep-alive comments
 * (`: keep-alive`, `: OPENROUTER PROCESSING`) that the SDK's event parser
 * drops, so nothing reaches the stream as a part until the model starts
 * answering. Reading the bytes underneath is what tells a provider still
 * holding the request apart from a connection that went quiet.
 */
export function fetchWithActivity(
  onActivity: () => void,
  fetchImpl: Fetch = globalThis.fetch,
  now: () => number = Date.now,
): Fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (!response.body) {
      return response;
    }
    let last = -Infinity;
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          const time = now();
          if (time - last >= ACTIVITY_INTERVAL_MS) {
            last = time;
            onActivity();
          }
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}
