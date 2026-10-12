import { type Session } from "../../src/schemas/session";

/**
 * The conversation as the user saw it in the chat: what they typed and what
 * the chat wrote back, in order, and nothing else. No tool calls, no notes
 * the harness wrote for the agent (a task finishing, an interruption), no
 * work done inside tasks. A question card shows as the question and its
 * choices, since the user sees those too.
 *
 * Written beside a chat run's transcript as `user-view.md`, for a grader
 * that scores the run from the user's side of the screen.
 */
export function renderUserView(
  sessions: Session.WithMessagesAndParts[],
): string {
  const lines: { at: number; text: string }[] = [];
  for (const session of sessions) {
    if (session.parentId) {
      continue;
    }
    for (const message of session.messages) {
      const at = message.metadata.createdAt.getTime();
      if (message.role === "user") {
        // A note the harness wrote (a task finishing, an app changing) is not
        // the user speaking, and nothing in the chat shows it as their words.
        const fromHarness = message.parts.some(
          (part) =>
            part.type === "data-taskEvent" || part.type === "data-appEvent",
        );
        const words = message.parts
          .flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
          .filter(Boolean)
          .join("\n");
        if (!fromHarness && words !== "") {
          lines.push({ at, text: `**User:** ${words}` });
        }
        continue;
      }
      if (message.role !== "assistant") {
        continue;
      }
      for (const part of message.parts) {
        if (part.type === "text" && part.text.trim() !== "") {
          lines.push({ at, text: `**Assistant:** ${part.text.trim()}` });
        } else if (part.type === "tool-choose" && part.input) {
          lines.push({
            at,
            text: `**Assistant (question card):** ${part.input.question ?? ""} [${(part.input.choices ?? []).join(" / ")}]`,
          });
        }
      }
    }
  }
  return `${lines
    .toSorted((a, b) => a.at - b.at)
    .map((line) => line.text)
    .join("\n\n")}\n`;
}
