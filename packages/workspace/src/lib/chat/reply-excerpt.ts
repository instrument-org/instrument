import { stripMarkdown } from "@instrument-org/shared/strip-markdown";

import { AGENT_FILES_LANGUAGE, AGENT_MESSAGE_LANGUAGE } from "../../constants";
import { parseFilesBlock } from "../parse-files-block";
import { parseMessage } from "../parse-message";
import { type SessionMessage } from "../../schemas/session/message";

/** How much of the agent's own words the list shows on a task's second line. */
export const LINE_MAX = 90;

/**
 * What an agent last wrote in a transcript already in hand, whole. A reply
 * stopped for repeating itself has none: what it streamed is the loop, and
 * the turn reads as ending without words, by its error.
 */
export function lastAssistantTextIn(
  messages: SessionMessage.WithParts[],
): string | undefined {
  const last = messages.findLast((message) => message.role === "assistant");
  if (last?.metadata.error?.kind === "repetition") {
    return undefined;
  }
  const text = last?.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
  return text || undefined;
}

/**
 * The one line a reply is read by, cut to what a row can show. Fenced blocks
 * are skipped whole: a reply that opens with the files it hands over is read
 * by its words. One that is nothing but that fence is read by what it wrote,
 * named from the fence's basenames, one that is a message by the message's own
 * first line under its headers, and any other fence with no words around it
 * by its first line, so no excerpt ever shows the fence itself.
 */
export function excerptOf(text: string, maxLength: number): string {
  /**
   * The fence being walked, undefined outside one: its info string, and the
   * run of backticks that opened it, since only a run at least as long closes
   * it, so a message opened with four can hold a code block.
   */
  let fence: { info: string; ticks: number } | undefined;
  const fencedFiles: string[] = [];
  const fencedMessage: string[] = [];
  let firstFenced: string | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const ticks = /^`{3,}/.exec(line)?.[0].length ?? 0;
    if (fence === undefined && ticks > 0) {
      fence = { info: line.slice(ticks).trim(), ticks };
      continue;
    }
    if (fence && ticks >= fence.ticks && line.slice(ticks).trim() === "") {
      fence = undefined;
      continue;
    }
    if (fence?.info === AGENT_MESSAGE_LANGUAGE) {
      fencedMessage.push(raw);
    }
    if (!line) {
      continue;
    }
    if (fence === undefined) {
      // Plain words: a row has no room for a bold marker or a link's target.
      return cut(stripMarkdown(line).trim(), maxLength);
    }
    if (fence.info === AGENT_FILES_LANGUAGE) {
      fencedFiles.push(line);
    }
    firstFenced ??= line;
  }
  const names = parseFilesBlock(fencedFiles.join("\n")).map(basename);
  const [first, ...more] = names;
  if (first === undefined) {
    const messageLine = parseMessage(fencedMessage.join("\n"))
      .body.split("\n")
      .find((line) => line.trim());
    return messageLine === undefined
      ? cut(firstFenced ?? "", maxLength)
      : cut(stripMarkdown(messageLine).trim(), maxLength);
  }
  return more.length === 0
    ? cut(`Wrote ${first}`, maxLength)
    : cut(`Wrote ${names.length} files: ${names.join(", ")}`, maxLength);
}

/** The last segment of a path, which is how a file is named in a line. */
function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").at(-1) || path;
}

function cut(line: string, maxLength: number): string {
  return line.length > maxLength ? `${line.slice(0, maxLength)}…` : line;
}
