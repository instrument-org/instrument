import { type SessionMessage } from "../../schemas/session/message";
import { actionsNoteLines } from "../actions-model-text";
import { ACTIVITY_COMMAND } from "../shell-commands/activity-command";

/** Whether the person wrote a message: words or an attachment, rather than a wake. */
function typed(message: SessionMessage.WithParts) {
  return (
    message.role === "user" &&
    message.parts.some(
      (part) =>
        (part.type === "text" && part.text.trim().length > 0) ||
        part.type === "data-attachments",
    )
  );
}

/**
 * The message a turn answered, as Settings › Activity shows it above the
 * turn's requests: the session's last user message sent at or before the
 * turn's first request, its words, the lines of the activity note it
 * carried (none when it carried none), and whether the agent ran
 * `instrument activity` before the next user message. Nothing when that
 * message was a wake rather than something the person wrote.
 */
export function turnMessageOf(
  messages: readonly SessionMessage.WithParts[],
  startedAt: number,
):
  | undefined
  | { at: Date; lookedUp: boolean; noteLines?: string[]; text: string } {
  const index = messages.findLastIndex(
    (message) =>
      message.role === "user" &&
      message.metadata.createdAt.getTime() <= startedAt,
  );
  const message = messages[index];
  if (!message || !typed(message)) {
    return undefined;
  }
  const next = messages.findIndex(
    (each, at) => at > index && each.role === "user",
  );
  const lookedUp = messages
    .slice(index + 1, next === -1 ? undefined : next)
    .some((each) =>
      each.parts.some(
        (part) =>
          part.type.startsWith("tool-") &&
          "input" in part &&
          JSON.stringify(part.input).includes(ACTIVITY_COMMAND.name),
      ),
    );
  const note = message.parts.find((part) => part.type === "data-actions");
  return {
    at: message.metadata.createdAt,
    lookedUp,
    ...(note?.type === "data-actions"
      ? { noteLines: actionsNoteLines(note.data) }
      : {}),
    text: message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim(),
  };
}
