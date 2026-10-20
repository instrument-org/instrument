import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { TOOL_NAMES } from "../tools/name";
import { systemNote } from "./system-note";

/** Tells the agent which skills and apps changed since its catalog and app list were written. */
export function setupNewsModelNote(
  data: SessionMessageDataPart.SetupNewsDataPart,
): string {
  const lines = (["skill", "app"] as const).flatMap((kind) => {
    const of = (change: string) =>
      data.changes
        .filter((each) => each.kind === kind && each.change === change)
        .map((each) => each.name);
    const parts = [
      of("added").length > 0 && `added ${of("added").join(", ")}`,
      of("changed").length > 0 && `changed ${of("changed").join(", ")}`,
    ].filter((part) => typeof part === "string");
    return parts.length === 0
      ? []
      : [`${kind === "skill" ? "Skills" : "Apps"}: ${parts.join("; ")}.`];
  });
  return systemNote`
    Since you last heard, another chat, the person or a program changed the workspace's setup. ${lines.join(" ")} \`${TOOL_NAMES.loadSkill}\` accepts the skills there now; what you remember of a changed one is out of date.
  `;
}
