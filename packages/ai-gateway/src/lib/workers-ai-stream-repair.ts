type Fetch = typeof globalThis.fetch;

/** What a tool call's first chunk is remembered by: its index, and the id given to it. */
interface RepairState {
  ids: Map<number, string>;
  made: number;
}

/** One line of the stream: an event is mended, anything else passes as it is. */
export function repairLine(line: string, state: RepairState): string {
  if (!line.startsWith("data:")) {
    return line;
  }
  const payload = line.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") {
    return line;
  }
  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return line;
  }
  return repairEvent(event, state) ? `data: ${JSON.stringify(event)}` : line;
}

/**
 * The request with any assistant tool call the endpoint would reject made
 * sendable again: arguments that do not parse as a JSON object become `{}`.
 *
 * Only that field is touched. A call whose arguments are merely truncated is
 * left alone deliberately -- the endpoint accepts it, and rewriting it would
 * throw away a step that did happen.
 */
export function repairRequestInit(init: RequestInit | undefined) {
  if (!init || typeof init.body !== "string") {
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
  let mended = false;
  for (const message of payload.messages) {
    if (!isRecord(message) || !Array.isArray(message.tool_calls)) {
      continue;
    }
    for (const call of message.tool_calls) {
      if (!isRecord(call) || !isRecord(call.function)) {
        continue;
      }
      const args = call.function.arguments;
      if (typeof args !== "string") {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(args);
      } catch {
        call.function.arguments = "{}";
        mended = true;
        continue;
      }
      // An array parses as JSON and is not an object, which is exactly what
      // the endpoint refuses, so `isRecord` is not the test here.
      if (!isRecord(parsed) || Array.isArray(parsed)) {
        call.function.arguments = "{}";
        mended = true;
      }
    }
  }
  return mended ? { ...init, body: JSON.stringify(payload) } : init;
}

/**
 * Workers AI streams two things the OpenAI SDK refuses, and each ends the turn
 * with an error the user reads as a task that died for nothing: a tool call
 * whose first chunk carries no `id`, and a text chunk whose content is a
 * number rather than a string. Both are mended on the way through, so the SDK
 * sees the stream it expects: an id made from the call's index where none
 * came, and the number as its digits.
 *
 * The request is mended too, and that half matters more. GLM sometimes emits a
 * tool call whose whole command is in the function *name* -- seen as
 * `bash|command|cat > file` and as `python work/build.py</arg_value>` -- with
 * arguments that are not a JSON object. The step is lost either way, but the
 * malformed call is then stored in the conversation, and Workers AI rejects
 * every later request that replays it: "Assistant tool call function.arguments
 * must be a JSON object", 400, forever. Measured, that is not a wasted step but
 * a task that can never take another turn, the same one failing twelve times in
 * a row. Rewriting those arguments to an empty object on the way out costs the
 * lost step and keeps the task alive.
 */
export function repairWorkersAiStream(
  fetchImpl: Fetch = globalThis.fetch,
): Fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, repairRequestInit(init));
    const type = response.headers.get("content-type") ?? "";
    if (!response.body || !type.includes("text/event-stream")) {
      return response;
    }
    return new Response(response.body.pipeThrough(repairTransform()), {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Mends the event in place; true when something was changed. */
function repairEvent(event: unknown, state: RepairState): boolean {
  if (!isRecord(event) || !Array.isArray(event.choices)) {
    return false;
  }
  let changed = false;
  for (const choice of event.choices) {
    if (!isRecord(choice) || !isRecord(choice.delta)) {
      continue;
    }
    const { delta } = choice;
    if (typeof delta.content === "number") {
      delta.content = String(delta.content);
      changed = true;
    }
    if (!Array.isArray(delta.tool_calls)) {
      continue;
    }
    for (const call of delta.tool_calls) {
      if (!isRecord(call)) {
        continue;
      }
      const index = typeof call.index === "number" ? call.index : 0;
      if (typeof call.id === "number") {
        call.id = String(call.id);
        changed = true;
      }
      if (call.id == null && !state.ids.has(index)) {
        // The first chunk of a call names it for every chunk after; a later
        // chunk without an id is ordinary, and needs none.
        const id = `call_${index}_${state.made++}`;
        state.ids.set(index, id);
        call.id = id;
        changed = true;
      } else if (typeof call.id === "string" && !state.ids.has(index)) {
        state.ids.set(index, call.id);
      }
    }
  }
  return changed;
}

/** The event stream, line by line, with each `data:` event mended. */
function repairTransform() {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state: RepairState = { ids: new Map(), made: 0 };
  let carry = "";
  return new TransformStream<Uint8Array, Uint8Array>({
    flush(controller) {
      const rest = carry + decoder.decode();
      if (rest) {
        controller.enqueue(encoder.encode(repairLine(rest, state)));
      }
    },
    transform(chunk, controller) {
      const text = carry + decoder.decode(chunk, { stream: true });
      const lines = text.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${repairLine(line, state)}\n`));
      }
    },
  });
}
