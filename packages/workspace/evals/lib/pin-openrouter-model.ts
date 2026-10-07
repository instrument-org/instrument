/**
 * Lets an eval process spend on OpenRouter only through the one model the
 * matrix was cleared to run there, and through nothing else.
 *
 * Loaded with `--import` by `evals/handoff-matrix.ts`, which names the model
 * in `INSTRUMENT_EVAL_OPENROUTER_MODEL` for the runs it hands an OpenRouter
 * key, and leaves it empty for every other run. A model URI is not the only
 * way a run reaches OpenRouter: image generation picks an image model of its
 * own there, and a web search away from the chat's provider picks
 * `openrouter/auto`. So the guard sits on the wire: every request to
 * OpenRouter that is not a read (a GET, which spends nothing) has to name the
 * pinned model and no other, or it is answered with a 403 here and never
 * sent. Each refusal is written to stderr as an `openrouter-guard refused`
 * line, so the matrix can say which side path tried.
 */
const pinned = process.env.INSTRUMENT_EVAL_OPENROUTER_MODEL || undefined;

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const isRequest = input instanceof Request;
  const href = isRequest ? input.url : String(input);
  const url = new URL(href);
  const method = (
    init?.method ?? (isRequest ? input.method : "GET")
  ).toUpperCase();
  if (!url.hostname.endsWith("openrouter.ai") || method === "GET") {
    return realFetch(input, init);
  }
  const body =
    init?.body === undefined || init.body === null
      ? isRequest
        ? await input.clone().text()
        : ""
      : await new Response(init.body).text();
  const asked = modelsIn(body);
  const allowed =
    pinned !== undefined &&
    asked.length > 0 &&
    asked.every((model) => model === pinned) &&
    !url.pathname.includes("/images");
  if (!allowed) {
    process.stderr.write(
      `openrouter-guard refused ${method} ${url.pathname} for ${asked.join(",") || "no model"}\n`,
    );
    return Response.json(
      {
        error: {
          code: 403,
          message: `The eval guard refused this request: only ${pinned ?? "no model"} may be spent on.`,
        },
      },
      { status: 403 },
    );
  }
  return realFetch(href, {
    ...init,
    body,
    headers: init?.headers ?? (isRequest ? input.headers : undefined),
    method,
  });
};

/** Every model a request body names: its `model`, and any `models` fallbacks. */
function modelsIn(body: string): string[] {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }
    const model = "model" in parsed ? parsed.model : undefined;
    const models = "models" in parsed ? parsed.models : undefined;
    return [
      ...(typeof model === "string" ? [model] : []),
      ...(Array.isArray(models)
        ? models.map((one) => (typeof one === "string" ? one : "?"))
        : []),
    ];
  } catch {
    return [];
  }
}
