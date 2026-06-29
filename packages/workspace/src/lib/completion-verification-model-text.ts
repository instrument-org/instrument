import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

export function completionVerificationModelNote(
  data: SessionMessageDataPart.CompletionVerificationDataPart,
) {
  return systemNote`
    The completion verifier found that the previous response was not ready to send to the user.
    Address these gaps using the available tools before you report completion.

    Verification attempt: ${data.attempt}
    Feedback:
    ${data.feedback}
  `;
}
