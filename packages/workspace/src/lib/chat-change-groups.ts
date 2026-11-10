import { type ChatId } from "../schemas/chat-id";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";

type ChatChange = SessionMessageDataPart.ChatChange;

/** The changes of a turn that did one thing, to however many chats. */
interface ChatChangeGroup {
  changes: ChatChange[];
  /** Tells groups apart: the field and what it was set to. */
  key: string;
  /** For chats filed, the project's id, or `null` for chats taken out of one. */
  project?: null | string;
  /** What was done, as the word a line opens with. */
  verb: string;
}

function groupOf(change: ChatChange): Omit<ChatChangeGroup, "changes"> {
  switch (change.field) {
    case "title": {
      return { key: "title", verb: "Renamed" };
    }
    case "archived": {
      return change.after
        ? { key: "archived", verb: "Archived" }
        : { key: "unarchived", verb: "Unarchived" };
    }
    case "starred": {
      return change.after
        ? { key: "starred", verb: "Starred" }
        : { key: "unstarred", verb: "Unstarred" };
    }
    case "project": {
      return change.after === null
        ? { key: "project:", project: null, verb: "Removed" }
        : {
            key: `project:${change.after}`,
            project: change.after,
            verb: "Moved",
          };
    }
  }
}

/** A turn's changes to chats, grouped by what was done, in the order first done. */
function chatChangeGroups(
  changes: readonly ChatChange[],
): ChatChangeGroup[] {
  const groups = new Map<string, ChatChangeGroup>();
  for (const change of changes) {
    const group = groupOf(change);
    const known = groups.get(group.key);
    if (known) {
      known.changes.push(change);
    } else {
      groups.set(group.key, { ...group, changes: [change] });
    }
  }
  return [...groups.values()];
}

/**
 * The heading over what a turn did to chats, from what it did: one kind of
 * change names it ("Archived 2 chats", "Starred a chat"), and several kinds
 * across the same chats say "Organized 5 chats".
 */
export function chatChangesHeading(changes: readonly ChatChange[]): string {
  const groups = chatChangeGroups(changes);
  const [only] = groups;
  const count = chatsChanged(changes).length;
  const chats = count === 1 ? "a chat" : `${count.toString()} chats`;
  if (groups.length !== 1 || !only) {
    return `Organized ${chats}`;
  }
  if (only.project === null) {
    return `Removed ${chats} from ${count === 1 ? "its project" : "their projects"}`;
  }
  return `${only.verb} ${chats}`;
}

/** A turn's changes to each chat, the chats in the order first changed. */
export function chatChangesByChat(
  changes: readonly ChatChange[],
): { changes: ChatChange[]; chat: ChatId }[] {
  return chatsChanged(changes).map((chat) => ({
    changes: changes.filter((change) => change.chat === chat),
    chat,
  }));
}

/** The chats a turn's changes name, each once, in the order first changed. */
export function chatsChanged(changes: readonly ChatChange[]): ChatId[] {
  return [...new Set(changes.map((change) => change.chat))];
}
