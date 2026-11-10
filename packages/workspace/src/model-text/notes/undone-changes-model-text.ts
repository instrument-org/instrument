import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { systemNote } from "./system-note";

type ChatChange = SessionMessageDataPart.ChatChange;
type ProjectFieldChange = SessionMessageDataPart.ProjectFieldChange;

/** Words for a field put back, as the agent reads them. */
const PROJECT_FIELD_WORDS: Record<ProjectFieldChange["field"], string> = {
  about: "about line",
  color: "color",
  emoji: "mark",
  icon: "mark",
  name: "name",
  retired: "deletion",
};

const CHAT_FIELD_WORDS: Record<ChatChange["field"], string> = {
  archived: "archive",
  project: "project",
  starred: "star",
  title: "title",
};

function listed(words: readonly string[]): string {
  const unique = [...new Set(words)];
  return unique.length < 2
    ? unique.join("")
    : `${unique.slice(0, -1).join(", ")} and ${unique.at(-1) ?? ""}`;
}

function except(skipped: number): string {
  return skipped > 0 ? ", except what they had changed since" : "";
}

/**
 * Tells the agent the person took back a turn's `instrument projects`
 * changes with the card's Undo, so it does not set them again. Nothing for
 * a card not undone.
 */
export function undoneProjectsModelNote(
  data: SessionMessageDataPart.SetupChangesDataPart,
): string | undefined {
  if (!data.undone) {
    return undefined;
  }
  const said = data.changes.flatMap((change) => {
    if (change.kind !== "project") {
      return [];
    }
    if (change.change === "added" && change.project) {
      return [`${change.name} deleted`];
    }
    const fields = change.fields ?? [];
    const renamed = fields.find((field) => field.field === "name");
    const others = listed(
      fields
        .filter((field) => field.field !== "name")
        .map((field) => PROJECT_FIELD_WORDS[field.field]),
    );
    if (renamed) {
      return [
        `${renamed.after} is ${renamed.before} again${others ? `, its ${others} as before` : ""}`,
      ];
    }
    return others ? [`${change.name}'s ${others} as before`] : [];
  });
  if (said.length === 0) {
    return undefined;
  }
  return systemNote`
    The user clicked Undo on your earlier project changes: ${said.join("; ")}${except(data.undone.skipped)}. Do not redo them unless asked.
  `;
}

/**
 * Tells the agent the person took back a turn's `instrument chats` changes
 * with the card's Undo, so it does not make them again. Nothing for a card
 * not undone.
 */
export function undoneChatsModelNote(
  data: SessionMessageDataPart.ChatChangesDataPart,
): string | undefined {
  if (!data.undone) {
    return undefined;
  }
  const fields = new Map<string, string[]>();
  for (const change of data.changes) {
    fields.set(change.chat, [
      ...(fields.get(change.chat) ?? []),
      CHAT_FIELD_WORDS[change.field],
    ]);
  }
  const said = [...fields].map(
    ([chat, words]) => `chat ${chat}'s ${listed(words)} as before`,
  );
  return systemNote`
    The user clicked Undo on your earlier chat changes: ${said.join("; ")}${except(data.undone.skipped)}. Do not redo them unless asked.
  `;
}
