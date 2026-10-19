type Fetch = typeof globalThis.fetch;

/**
 * The request with every user and assistant message's text as a list of
 * parts, and an assistant message's cache marker on its last text part.
 * Applied only to a request that carries a cache marker, which is a request
 * to an Anthropic model (`addCacheControlToMessages`).
 *
 * The OpenRouter provider sends a message holding one text part as a plain
 * string unless that part is marked, and as a list when it is. OpenRouter
 * joins consecutive user messages differently when they are all strings than
 * when one is a list, so a message marked as the newest in one request and
 * sent unmarked in the next changes the bytes of everything from the first
 * of its run onward. A chat's context message and its first user message are
 * such a run, so every session wrote its context to the cache twice. Measured
 * live on Anthropic, Bedrock and Vertex: marked-then-string reads back only
 * the system prompt; list-both-times reads back the whole prefix.
 *
 * The provider also puts an assistant message's marker on the message, where
 * OpenRouter ignores it; on a text part it is honored.
 */
export function stabilizeCacheShape(init: RequestInit | undefined) {
  if (
    !init ||
    typeof init.body !== "string" ||
    !init.body.includes('"cache_control"')
  ) {
    return init;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(init.body);
  } catch {
    return init;
  }
  if (!isRecord(payload) || !Array.isArray(payload.messages)) {
    return init;
  }
  let changed = false;
  for (const message of payload.messages) {
    if (
      !isRecord(message) ||
      (message.role !== "user" && message.role !== "assistant")
    ) {
      continue;
    }
    if (typeof message.content === "string" && message.content !== "") {
      message.content = [{ text: message.content, type: "text" }];
      changed = true;
    }
    if (message.role === "assistant" && "cache_control" in message) {
      const lastText = Array.isArray(message.content)
        ? message.content.findLast(
            (part): part is Record<string, unknown> =>
              isRecord(part) && part.type === "text",
          )
        : undefined;
      if (lastText) {
        lastText.cache_control = message.cache_control;
        delete message.cache_control;
        changed = true;
      }
    }
  }
  return changed ? { ...init, body: JSON.stringify(payload) } : init;
}

/** `fetchImpl` with `stabilizeCacheShape` applied to every request it sends. */
export function openRouterCacheShape(
  fetchImpl: Fetch = globalThis.fetch,
): Fetch {
  return (input, init) => fetchImpl(input, stabilizeCacheShape(init));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
