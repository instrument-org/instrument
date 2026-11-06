import { keptAtom } from "@/client/lib/kept-state";

export const CHAT_NOTES = ["dashes", "words", "off"] as const;

export type ChatNotes = (typeof CHAT_NOTES)[number];

/** What a developer's margin notes show at rest. */
export const chatNotesAtom = keptAtom<ChatNotes>(
  "view",
  "chat-notes.v1",
  "dashes",
  (value, initial) => CHAT_NOTES.find((each) => each === value) ?? initial,
);

export const CHAT_NOTES_LABEL: Record<ChatNotes, string> = {
  dashes: "Dashes",
  off: "Off",
  words: "Words",
};
