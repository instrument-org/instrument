import { type ChatId } from "../schemas/chat-id";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";

type ChatChange = SessionMessageDataPart.ChatChange;

/** The changes of a turn that did one thing, to however many chats. */
export interface ChatChangeGroup {
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
            verb: "Filed",
          };
    }
  }
}

/** A turn's changes to chats, grouped by what was done, in the order first done. */
export function chatChangeGroups(
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
 * A group's words: "Renamed 12 chats", "Filed 9 under Travel". Only the
 * first group of a line says "chats", and `projectName` is the name its
 * project goes by now, where it still has one.
 */
export function chatChangeGroupWords(
  group: ChatChangeGroup,
  { first, projectName }: { first: boolean; projectName?: string },
): string {
  const count = group.changes.length;
  const chats = first ? (count === 1 ? " chat" : " chats") : "";
  const where =
    group.project === undefined
      ? ""
      : group.project === null
        ? count === 1
          ? " from its project"
          : " from their projects"
        : ` under ${projectName ?? "a project"}`;
  return `${group.verb} ${count.toString()}${chats}${where}`;
}

/** The chats a turn's changes name, each once, in the order first changed. */
export function chatsChanged(changes: readonly ChatChange[]): ChatId[] {
  return [...new Set(changes.map((change) => change.chat))];
}
