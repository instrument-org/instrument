import { systemNote } from "../notes/system-note";

/**
 * What the first step of a chat's turn is sent with when the user typed the
 * message it answers: a sentence to them before any work. A note rather than
 * a prompt rule, since it is read where the turn starts, and placed after the
 * cache breakpoints for that one request, never stored. A task gets none:
 * nobody reads its lines as they come.
 */
export const TURN_NOTE = systemNote`
  Before using any tool, tell the user in a sentence what you are doing. If no tool is needed, just answer.
`;

/**
 * What a step is sent with when the model ran out of room to write: its reply
 * stops mid-word, and the step that follows is the rest of it. The note says
 * so, because a model handed its own unfinished text with nothing else will
 * either start over or answer as though it had finished.
 */
export const LENGTH_NOTE = systemNote`
  Your last reply was cut off at the output limit, mid-word. Carry on from exactly where it stops, without repeating what is already there and without starting over. Write less at a time.
`;
