/**
 * Waits out Workers AI's per-minute request limit rather than failing the
 * turn over it.
 *
 * Loaded with `--import` by `evals/handoff-matrix.ts`. Several eval
 * processes on one Cloudflare account reach the limit together, and a model
 * request refused that way fails the run as a provider error, which says
 * nothing about the arm being measured. Each wait is written to stderr as a
 * `rate-limit wait` line, so the matrix can tell a run whose timings include
 * one from a run whose timings do not.
 *
 * Only Workers AI: on the ChatGPT plan a 429 is the plan saying stop.
 */
const DELAYS_MS = [5000, 10_000, 20_000, 30_000, 45_000, 60_000];

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const isRequest = input instanceof Request;
  const href = isRequest ? input.url : String(input);
  if (!new URL(href).hostname.endsWith("api.cloudflare.com")) {
    return realFetch(input, init);
  }
  // Read once, so the same body can be sent again: a body the gateway
  // forwards as a stream can be sent only once.
  const body =
    init?.body === undefined || init.body === null
      ? isRequest
        ? await input.clone().arrayBuffer()
        : undefined
      : await new Response(init.body).arrayBuffer();
  const send = () =>
    realFetch(href, {
      ...init,
      body,
      headers: init?.headers ?? (isRequest ? input.headers : undefined),
      method: init?.method ?? (isRequest ? input.method : undefined),
    });
  let response = await send();
  for (const delay of DELAYS_MS) {
    if (response.status !== 429) {
      break;
    }
    await response.body?.cancel();
    process.stderr.write(`rate-limit wait ${delay / 1000}s\n`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    response = await send();
  }
  return response;
};
