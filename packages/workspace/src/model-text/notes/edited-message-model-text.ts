import { systemNote } from "./system-note";

/**
 * Beside a message the person edited: the conversation after its earlier
 * version is gone, while what was done in it is not.
 */
export const EDITED_MESSAGE_NOTE = systemNote`
  The user edited an earlier message, and this replaces it and everything that came after it, which you no longer see. What was done there still stands: files made or changed, messages sent, commands left running. Check the current state before you repeat any of it. Tasks started there were stopped.
`.trim();
