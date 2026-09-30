/**
 * The Responses API behind a ChatGPT plan accepts a narrower request than the
 * public one: every request streams, nothing is stored, and a set of fields
 * the platform takes is refused outright. The SDK and our callers write the
 * ordinary shape, so the proxy rewrites a request on its way out rather than
 * every caller learning the difference.
 */

/**
 * Fields the plan's Responses route refuses. `previous_response_id` goes too,
 * since nothing is stored to point back at; the full history is in `input`.
 */
const UNSUPPORTED_FIELDS = new Set<string>([
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "previous_response_id",
  "prompt",
  "prompt_cache_retention",
  "safety_identifier",
  "service_tier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
]);

/**
 * Collapse the event stream of a request that was forced to stream back into
 * the single JSON body its caller asked for. `response.completed` carries the
 * whole response, which is the non-streamed body; a failure becomes the
 * platform's error shape so the SDK reports it as it would any other.
 */
export async function collapseResponsesStream(
  upstream: Response,
): Promise<Response> {
  if (!upstream.ok || !upstream.body) {
    return upstream;
  }
  const text = await upstream.text();
  // The terminal event's response may arrive with an empty `output`, the
  // items having been sent one by one as they finished, so they are kept
  // and put back.
  const items: unknown[] = [];
  for (const event of parseServerSentEvents(text)) {
    if (event.type === "response.output_item.done") {
      items.push(event.item);
    }
    if (
      event.type === "response.completed" ||
      event.type === "response.incomplete"
    ) {
      return Response.json(withOutput(event.response, items));
    }
    if (event.type === "response.failed") {
      const error = (event.response as undefined | { error?: unknown })?.error;
      return Response.json({ error }, { status: statusForError(error) });
    }
    if (event.type === "error") {
      return Response.json(
        { error: event.error ?? event },
        { status: statusForError(event.error ?? event) },
      );
    }
  }
  return Response.json(
    {
      error: {
        code: "stream_ended_early",
        message: "The ChatGPT plan's stream ended without a completed response",
      },
    },
    { status: 502 },
  );
}

export function rewriteChatGPTPlanResponsesBody(
  body: Record<string, unknown>,
  { sessionId }: { sessionId?: null | string } = {},
): { body: Record<string, unknown>; streamed: boolean } {
  const streamed = body.stream === true;
  const next = Object.fromEntries(
    Object.entries(body).filter(([field]) => !UNSUPPORTED_FIELDS.has(field)),
  );
  next.store = false;
  next.stream = true;
  // Nothing is stored, so the cache is what saves a long session from being
  // read in full every step. Without a key the route caches nothing across
  // requests; one per session keeps a session's steps on one prefix.
  if (sessionId && next.prompt_cache_key === undefined) {
    next.prompt_cache_key = sessionId;
  }
  if (Array.isArray(next.input)) {
    // A system message item is refused; a developer one says the same thing.
    // The SDK writes `system` for a model id it does not recognize as a
    // reasoning model.
    next.input = next.input.map((item: unknown) =>
      isSystemMessage(item) ? { ...item, role: "developer" } : item,
    );
  }
  return { body: next, streamed };
}

/**
 * A spent plan allowance refused before the stream opens comes back as a
 * 429, which the SDK retries on its own. Waiting does not end it, so it is
 * passed on as the refusal it is, body untouched: the code in it is what
 * the error is classified by.
 */
export async function withoutRetryOnSpentLimit(
  upstream: Response,
): Promise<Response> {
  if (upstream.status !== 429) {
    return upstream;
  }
  const text = await upstream.text();
  return new Response(text, {
    headers: upstream.headers,
    status: text.includes("subscription_sharing_usage_limit_exceeded")
      ? 403
      : 429,
  });
}

function isSystemMessage(
  item: unknown,
): item is Record<string, unknown> & { role: "system" } {
  return (
    typeof item === "object" &&
    item !== null &&
    "role" in item &&
    item.role === "system" &&
    (!("type" in item) || item.type === "message")
  );
}

function* parseServerSentEvents(
  text: string,
): Generator<Record<string, unknown> & { type?: unknown }> {
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed === "object" && parsed !== null) {
        yield parsed as Record<string, unknown>;
      }
    } catch {
      // A malformed event is skipped; the terminal event decides the result.
    }
  }
}

function statusForError(error: unknown): number {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  switch (code) {
    case "subscription_sharing_invalid_user": {
      return 401;
    }
    case "subscription_sharing_usage_limit_exceeded": {
      return 429;
    }
    case "subscription_sharing_usage_unavailable":
    case "subscription_sharing_user_unavailable": {
      return 503;
    }
    default: {
      return 400;
    }
  }
}

function withOutput(response: unknown, items: unknown[]): unknown {
  if (typeof response !== "object" || response === null) {
    return response;
  }
  const output = "output" in response ? response.output : undefined;
  return Array.isArray(output) && output.length > 0
    ? response
    : { ...response, output: items };
}
