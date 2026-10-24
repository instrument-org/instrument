import { placeholderTitle } from "@instrument-org/shared";

import { type SessionMessage } from "../../schemas/session/message";
import { isUntitledChatSessionTitle } from "../generate-session-title";
import { excerptOf } from "./standing";

/** How much of the opening ask an untitled chat's placeholder is cut from. */
const ROOT_EXCERPT_MAX = 160;

/**
 * The title a chat is shown by. Until the agent names it, the opening ask's
 * own first words stand for it rather than the placeholder a session is born
 * with, so the chat list and the chat's folder read the same.
 */
export function shownTitle(
  title: string,
  root: SessionMessage.WithParts | undefined,
): string {
  if (!isUntitledChatSessionTitle(title)) {
    return title;
  }
  const said = (root?.parts ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
  return openingTitle(said) || title;
}

/**
 * The first words of an opening ask, held to a title's length: what an
 * untitled chat is shown by, and what its own session's header starts it
 * as. Empty when the ask has no words.
 */
export function openingTitle(said: string): string {
  return placeholderTitle(excerptOf(said, ROOT_EXCERPT_MAX));
}
