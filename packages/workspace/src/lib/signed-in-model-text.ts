import { APP_NAME } from "@instrument-org/shared";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * The note a sign-in wakes the session with: the person signed in to
 * Instrument from the note over their message box, so what waited on it
 * can go ahead.
 */
export function signedInModelNote(
  data: SessionMessageDataPart.SignedInDataPart,
): string {
  switch (data.waitedFor) {
    case "image": {
      return systemNote`The person signed in to ${APP_NAME}, so images work now. Nobody typed anything; make the image they asked for.`;
    }
  }
}
