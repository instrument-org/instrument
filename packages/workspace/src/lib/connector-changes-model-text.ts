import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

export function connectorChangesModelNote(
  data: SessionMessageDataPart.ConnectorChangesDataPart,
): null | string {
  if (data.connectors.length === 0) {
    return null;
  }

  const verb: Record<SessionMessageDataPart.ConnectorChange["change"], string> =
    {
      added: "was added",
      disabled: "was disabled",
      enabled: "is now enabled and ready to use",
      removed: "was removed",
    };

  const lines = data.connectors
    .map((c) => `- ${c.slug} (${c.displayName}) ${verb[c.change]}`)
    .join("\n");

  return systemNote`
    Data connectors changed since your last activity. Use the current set via connector_request; do not recreate existing ones.
    ${lines}
  `;
}
