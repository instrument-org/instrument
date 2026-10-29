import { type SessionMessage } from "../schemas/session/message";
import { filesNamedIn } from "./parse-files-block";
import { isChatFileHref, chatFilePathFromHref } from "./chat-file-href";
import { linkTargetsIn } from "./link-targets";

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

  for (const path of filesNamedIn(text)) {
    named.add(path);
  }

  // Only a link: a path sitting in prose is text, and the renderer draws no
  // chip for it. Which targets name a file rather than a web page is
  // `isChatFileHref`'s to say, the same as it is for the renderer.
  // Parsing is what a reply costs here, read for every reply of a chat each
  // time its digest is derived, and text with none of these draws no link.
  const mayLink = ["](", "]:", "<"].some((mark) => text.includes(mark));
  for (const target of mayLink ? linkTargetsIn(text) : []) {
    if (isChatFileHref(target)) {
      named.add(chatFilePathFromHref(target));
    }
  }

  return named;
}
