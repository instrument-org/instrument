// What each kind of message is called and drawn as, wherever a message
// document or a ```message fence shows its kind.
import { type MessageKind } from "@instrument-org/workspace/client";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { ChatsIcon } from "@phosphor-icons/react/Chats";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/EnvelopeSimple";
import { MegaphoneIcon } from "@phosphor-icons/react/Megaphone";
import { NoteIcon } from "@phosphor-icons/react/Note";
import { type ReactNode } from "react";

const KIND: Record<MessageKind, { icon: ReactNode; label: string }> = {
  chat: { icon: <ChatsIcon />, label: "Message" },
  comment: { icon: <ChatCircleIcon />, label: "Comment" },
  email: { icon: <EnvelopeSimpleIcon />, label: "Email" },
  other: { icon: <NoteIcon />, label: "Text" },
  post: { icon: <MegaphoneIcon />, label: "Post" },
  text: { icon: <ChatCircleIcon />, label: "Text" },
};

/** What a message is, as the card's head names it: its glyph and its word. */
export function messageKindOf(kind: MessageKind): {
  icon: ReactNode;
  label: string;
} {
  return KIND[kind];
}
