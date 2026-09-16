import { formatDistanceStrict } from "date-fns";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * Tells a fresh thread's agent what the user's other threads are about, so
 * three words typed at the top level can be read against them: "add the
 * Zevia line" is about the thread whose title names the shopping list, and
 * `chat read` gets it the rest. Says the list and stops there; whether to
 * read one is the agent's own instructions.
 */
export function threadContextModelNote(
  data: SessionMessageDataPart.ThreadContextDataPart,
) {
  if (data.threads.length === 0) {
    return systemNote`
      This is the first thread of the user's chat; there are no others to read.
    `;
  }
  const rows = data.threads
    .map((thread) => {
      // Two stored instants a fixed distance apart, so the words come out the
      // same every time the transcript is rebuilt.
      const when = formatDistanceStrict(
        new Date(thread.at),
        new Date(data.sentAt),
        { addSuffix: true },
      );
      const topics =
        thread.topics.length > 0 ? ` [${thread.topics.join(", ")}]` : "";
      const latest = thread.latest ? ` · ${thread.latest}` : "";
      return `- ${when} · "${thread.title}"${topics}${latest}`;
    })
    .join("\n");
  return systemNote`
    Other threads in the user's chat, newest first, each as when it last moved, its title, its topics, and its latest line:
    ${rows}
    A message here that only makes sense against one of them is about that thread: \`chat read <title words>\` reads it before you answer.
  `;
}
