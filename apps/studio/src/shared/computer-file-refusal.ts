/**
 * The header a 403 from the computer file channel carries when the
 * operating system refused the read (`system`, macOS privacy; `account`,
 * the file's own permissions), so a viewer says whose refusal it is, and
 * offers the ways past one, rather than calling the file private or gone.
 * Absent, the 403 is the app's own data.
 */
export const COMPUTER_FILE_REFUSAL_HEADER = "X-Refusal";
