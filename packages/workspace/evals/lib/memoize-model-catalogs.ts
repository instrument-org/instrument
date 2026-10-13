/**
 * Asks each provider for its model list once per process, and waits out a
 * rate limit on that request rather than failing the turn over it.
 *
 * Loaded with `--import` by `evals/handoff-matrix.ts`. The ChatGPT plan's
 * catalog is read fresh on every message and every turn, by design, and
 * several eval processes doing that at once draw 429s from the endpoint,
 * which fail the turn before the model is ever asked anything. A catalog
 * does not change during a run, so one read per process measures the same
 * thing.
 */
const TTL_MS = 10 * 60_000;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

const cached = new Map<
  string,
  Promise<{
    at: number;
    body: string;
    headers: [string, string][];
    status: number;
  }>
>();

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  // Read without constructing a Request, which would consume the body of a
  // request passed through untouched.
  const isRequest = input instanceof Request;
  const href = isRequest ? input.url : String(input);
  const method = (
    init?.method ?? (isRequest ? input.method : "GET")
  ).toUpperCase();
  if (method !== "GET" || !new URL(href).pathname.endsWith("/models")) {
    return realFetch(input, init);
  }
  const headers = new Headers(
    init?.headers ?? (isRequest ? input.headers : undefined),
  );
  const key = `${href}\n${headers.get("authorization") ?? ""}\n${headers.get("x-api-key") ?? ""}`;
  const hit = cached.get(key);
  const fresh = hit ? await hit.catch(() => undefined) : undefined;
  if (fresh && Date.now() - fresh.at < TTL_MS) {
    return new Response(fresh.body, {
      headers: fresh.headers,
      status: fresh.status,
    });
  }
  const pending = (async () => {
    let response = await realFetch(href, { headers });
    for (const delay of RETRY_DELAYS_MS) {
      if (response.status !== 429) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      response = await realFetch(href, { headers });
    }
    return {
      at: Date.now(),
      body: await response.text(),
      headers: [...response.headers.entries()],
      status: response.status,
    };
  })();
  cached.set(key, pending);
  const result = await pending;
  if (result.status !== 200) {
    cached.delete(key);
  }
  return new Response(result.body, {
    headers: result.headers,
    status: result.status,
  });
};
