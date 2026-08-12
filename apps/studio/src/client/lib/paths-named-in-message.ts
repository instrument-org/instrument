import {
  AGENT_FILES_LANGUAGE,
  type SessionMessage,
} from "@instrument-org/workspace/client";

import { parseFilesBlock } from "./parse-files-block";
import { isTaskFileHref, taskFilePathFromHref } from "./task-file-href";

const FENCE = new RegExp(
  String.raw`^[ \t]*\x60{3,}[ \t]*${AGENT_FILES_LANGUAGE}[ \t]*$([\s\S]*?)^[ \t]*\x60{3,}[ \t]*$`,
  "gmu",
);

// A Markdown link target. Only a link: a path sitting in prose is text, and the
// renderer draws no chip for it. Which targets name a file rather than a web
// page is `isTaskFileHref`'s to say, the same as it is for the renderer.
const LINK_TARGET = /\[[^\]]*\]\(\s*([^)\s]+)/gu;

/**
 * Every file path the message already puts on screen as something to click.
 *
 * Two ways a reply does that: a ` ```files ` fence, and a Markdown link whose
 * target is a path. Both become affordances; a path merely mentioned in a
 * sentence does not, which is why prose is not counted here.
 *
 * Used to keep the retired `data-fileChanges` grid from drawing a second copy
 * of a file the reply has already shown. Reading the message's own text is the
 * only way to know: the part was written by a watcher that had no idea what the
 * reply said.
 */
// Keyed by the message object, so the work happens once for a message rather
// than once per part of it, and the entry goes when the message does. A live
// query hands out a new object per update, which is exactly when the answer
// could have changed.
const cache = new WeakMap<SessionMessage.WithParts, Set<string>>();

export function pathsNamedInMessage(
  message: SessionMessage.WithParts,
): ReadonlySet<string> {
  const cached = cache.get(message);
  if (cached) {
    return cached;
  }
  const named = collectPaths(message);
  cache.set(message, named);
  return named;
}

function collectPaths(message: SessionMessage.WithParts): Set<string> {
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");

  const named = new Set<string>();

  for (const match of text.matchAll(FENCE)) {
    for (const path of parseFilesBlock(match[1] ?? "")) {
      named.add(path);
    }
  }

  for (const match of text.matchAll(LINK_TARGET)) {
    const target = match[1];
    if (target !== undefined && isTaskFileHref(target)) {
      named.add(taskFilePathFromHref(target));
    }
  }

  return named;
}
