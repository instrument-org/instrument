import { type SessionMessagePart } from "../schemas/session/message-part";

// Transient field smuggled onto a tool's output when converting to model
// messages, so a tool's `toModelOutput` can read context items collected as a
// side channel into part metadata. Never persisted, never sent to the client.
const FIELD = "__contextItems";

export function extractContextItemsFromOutput(
  output: unknown,
): SessionMessagePart.ToolPartContextItem[] {
  return (
    (output as { [FIELD]?: SessionMessagePart.ToolPartContextItem[] })[FIELD] ??
    []
  );
}

export function injectContextItemsIntoOutput<T>(
  output: T,
  contextItems: SessionMessagePart.ToolPartContextItem[] | undefined,
): T {
  if (!contextItems?.length) {
    return output;
  }
  return {
    ...(output as Record<string, unknown>),
    [FIELD]: contextItems,
  } as T;
}
