/** The working line while a summary of the conversation is written. */
export const SUMMARIZING_LINE = "Summarizing the conversation";

/** Whether these messages carry the mark of a summary being written. */
export function isSummarizing(
  messages: readonly { parts: readonly { type: string }[] }[],
): boolean {
  return messages.some((message) =>
    message.parts.some((part) => part.type === "data-summarizing"),
  );
}
