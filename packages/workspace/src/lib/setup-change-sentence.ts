import { skillMentionLabel } from "@instrument-org/shared/skill-mention";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";

type SetupChange =
  SessionMessageDataPart.SetupChangesDataPart["changes"][number];

/**
 * What a chat says it did to one item of the person's setup, as the words
 * around the item's name, so the app can make the name a link and a
 * transcript can write the sentence out. `label` replaces how the name is
 * shown, for a skill that is not invoked by its slash form.
 */
export function setupChangeSentence(
  { change, kind, name }: SetupChange,
  { label }: { label?: string } = {},
): { after: string; before: string; label: string } {
  switch (kind) {
    case "app": {
      return {
        after: " app.",
        before:
          change === "added"
            ? "Set up the "
            : change === "changed"
              ? "Updated the "
              : "Removed the ",
        label: label ?? name,
      };
    }
    case "memory": {
      // A memory is its file, which is how the person finds it again.
      const file = label ?? `${name}.md`;
      return change === "added"
        ? { after: " to your memories.", before: "Saved ", label: file }
        : change === "changed"
          ? { after: " in your memories.", before: "Updated ", label: file }
          : { after: " from your memories.", before: "Removed ", label: file };
    }
    case "skill": {
      return {
        after: " skill.",
        before:
          change === "added"
            ? "Created the "
            : change === "changed"
              ? "Updated the "
              : "Removed the ",
        label: label ?? skillMentionLabel(name),
      };
    }
    case "topic": {
      return {
        after: " topic.",
        before:
          change === "added"
            ? "Created the "
            : change === "changed"
              ? "Updated the "
              : "Removed the ",
        label: label ?? name,
      };
    }
  }
}
