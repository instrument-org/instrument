import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * The places the user marked in their files, as a numbered list the agent
 * works through: each file by its path and how the agent reaches it, where in
 * the file, what is there, and what the user wants there. The excerpt is
 * the file's own text, quoted, so it reads as the thing to find rather than
 * as words addressed to the agent. A place marked with nothing typed is one
 * the user wants looked at, with their message saying what for.
 */
export function asksModelNote(data: SessionMessageDataPart.AsksDataPart) {
  const items = data.asks
    .map((ask, index) => {
      const reach = ask.file.mount
        ? `you reach it at \`${ask.file.mount}\``
        : "no folder you can reach covers it: ask for it with request_folder";
      const excerpt = ask.excerpt?.trim()
        ? `\n${ask.excerpt
            .trim()
            .split("\n")
            .map((line) => `   > ${line}`)
            .join("\n")}`
        : "";
      const context = ask.context?.trim()
        ? `\n${ask.context
            .trim()
            .split("\n")
            .map((line) => `   ${line.trim()}`)
            .join("\n")}`
        : "";
      const instruction = ask.instruction.trim()
        ? `\n   Asked: ${ask.instruction.trim()}`
        : "\n   No instruction of its own: the message says what to do with it.";
      return `${index + 1}. \`${ask.file.name}\`, ${ask.target} (\`${ask.file.path}\`; ${reach})${excerpt}${context}${instruction}`;
    })
    .join("\n");
  const many = data.asks.length > 1;
  const note = systemNote`
    The user marked ${many ? `${data.asks.length} places` : "a place"} in their files, ${many ? "each with" : "with"} what they want there: usually a change to make in the file, sometimes a question about it. "This", "here" and "it" in the message refer to ${many ? "these" : "it"}.
  `;
  return `${note}\n${items}`;
}
