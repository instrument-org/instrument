import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";

/**
 * What a branch's agent is told after the conversation it was copied, about
 * the chat it came from: that the chat goes on apart from it, where its
 * folders are to read from, and that new work goes in the branch's own.
 * `shellPath` spells each folder as the agent's shell does.
 */
export function branchedFromModelNote(
  data: SessionMessageDataPart.BranchedFromDataPart,
  shellPath: (hostPath: string) => string = (hostPath) => hostPath,
): string {
  const folder = (hostPath: string) => `${shellPath(hostPath)}/`;
  return [
    `This chat is a branch of "${data.title}", copied up to the reply above. That chat is still there and goes on separately.`,
    "",
    ...(data.folder === undefined
      ? []
      : [`Its folder: ${folder(data.folder)}`]),
    `Its work folder: ${folder(data.work)}`,
    `Its records: ${folder(data.records)}`,
    "",
    "Read from them when you need a file it made. Put new work in this chat's own folders.",
  ].join("\n");
}
