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
 * Workers AI streams two things the OpenAI SDK refuses, and each ends the turn
 * with an error the user reads as a task that died for nothing: a tool call
 * whose first chunk carries no `id`, and a text chunk whose content is a
 * number rather than a string. Both are mended on the way through, so the SDK
 * sees the stream it expects: an id made from the call's index where none
 * came, and the number as its digits.
 */
export function repairWorkersAiStream(
  fetchImpl: Fetch = globalThis.fetch,
): Fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
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
