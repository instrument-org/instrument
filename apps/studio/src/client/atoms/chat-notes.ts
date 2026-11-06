import { keptAtom } from "@/client/lib/kept-state";

/** Whether a developer's chats show their margin notes. */
export const chatNotesAtom = keptAtom<boolean>(
  "view",
  "chat-notes.v2",
  true,
  (value, initial) => (typeof value === "boolean" ? value : initial),
);
