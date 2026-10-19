/**
 * What the person reads when programs the agent runs have no sandbox on
 * macOS or Linux, in the notifications bell and in Settings › Permissions.
 */
export const SANDBOX_OFF_TITLE =
  "Programs the agent runs can reach all your files";

export const SANDBOX_OFF_NOTICE =
  "Instrument couldn't put a sandbox around programs the agent runs, like Python scripts, so they can reach any file you can. Its own tools still follow your permissions.";

/** Why it happened, as far as the computer's own settings show, for each reason. */
export const SANDBOX_OFF_REASONS = {
  "no-bubblewrap":
    "This computer doesn't have bubblewrap, the program Instrument uses for the sandbox. Installing your system's bubblewrap package adds it.",
  "no-seatbelt":
    // oxlint-disable-next-line studio/no-os-words -- shown only on macOS
    "This Mac is missing the system tool Instrument uses for the sandbox, which we don't expect. Please tell us with Report a Problem in the Help menu.",
  "user-namespaces-closed":
    "Linux on this computer is set to block the kind of sandbox Instrument uses. One known cause is running Instrument from its AppImage on Ubuntu, and installing the .deb package is the first thing to try.",
} satisfies Record<
  "no-bubblewrap" | "no-seatbelt" | "user-namespaces-closed",
  string
>;
