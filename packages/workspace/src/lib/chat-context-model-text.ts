import { formatDistanceStrict } from "date-fns";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * Tells a fresh chat's agent what the user's other chats are about, so
 * three words typed at the top level can be read against them: "add the
 * Zevia line" is about the chat whose title names the shopping list, and
 * `chat read` gets it the rest. Says the list and stops there; whether to
 * read one is the agent's own instructions.
 */
export function chatContextModelNote(
  data: SessionMessageDataPart.ChatContextDataPart,
) {
  if (data.chats.length === 0) {
    return systemNote`
      This is the user's first chat; there are no others to read.
    `;
  }
  const rows = data.chats
    .map((chat) => {
      // Two stored instants a fixed distance apart, so the words come out the
      // same every time the transcript is rebuilt.
      const when = formatDistanceStrict(
        new Date(chat.at),
        new Date(data.sentAt),
        { addSuffix: true },
      );
      const topics =
        chat.topics.length > 0 ? ` [${chat.topics.join(", ")}]` : "";
      const latest = chat.latest ? ` · ${chat.latest}` : "";
      // The id leads the row where the note has one, since it is what a link
      // to the chat carries and what `chat read` takes without guessing.
      const id = chat.id ? `${chat.id} · ` : "";
      return `- ${id}${when} · "${chat.title}"${topics}${latest}`;
    })
    .join("\n");
  return systemNote`
    The user's other chats, newest first, each by its id, when it last moved, its title, its topics, and its latest line:
    ${rows}
    A message here that only makes sense against one of them is about that chat: \`chat read <id or title words>\` reads it before you answer.
  `;
}
