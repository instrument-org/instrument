/**
 * What the person reads when no sandbox can hold the programs the agent runs
 * on macOS or Linux, in the notifications bell and in Settings › Permissions:
 * one version while those programs don't run, and one once the person chose
 * to run them anyway.
 */
export const SANDBOX_OFF_COPY = {
  allowed: {
    notice:
      "You chose to run them without a sandbox on this computer, so they can reach any file you can.",
    settings:
      "Programs the agent runs, like Python scripts, can reach any file you can. Instrument's own tools still follow this list.",
    title: "Programs the agent runs can reach all your files",
  },
  refused: {
    notice:
      "Instrument's sandbox isn't working on this computer, so it won't run programs like Python scripts for the agent until you decide what to do.",
    settings:
      "Until then, the agent can still read and write files with its own tools, but programs like Python scripts, git and its search commands won't run.",
    title: "The agent can't run programs right now",
  },
} as const;

/** What the person reads when web pages in the browser have no sandbox. */
export const BROWSER_SANDBOX_OFF_COPY = {
  notice:
    "A harmful page could reach your files. Installing Instrument's .deb package fixes this on Ubuntu.",
  title: "Web pages in the browser aren't sandboxed",
} as const;

/** Why it happened, as far as the computer's own settings show, for each reason. */
export const SANDBOX_OFF_REASONS = {
  "did-not-start":
    "Instrument's sandbox didn't start on this computer, and its settings don't show why. It tries again with each program, so this can clear up on its own.",
  "no-bubblewrap":
    "This computer doesn't have bubblewrap, the program Instrument uses for the sandbox. Installing your system's bubblewrap package adds it.",
  "no-seatbelt":
    // oxlint-disable-next-line studio/no-os-words -- shown only on macOS
    "This Mac is missing the system tool Instrument uses for the sandbox, which we don't expect. Please tell us with Report a Problem in the Help menu.",
  "user-namespaces-closed":
    "Linux on this computer is set to block the kind of sandbox Instrument uses. One known cause is running Instrument from its AppImage on Ubuntu 24.04, and installing the .deb package is the first thing to try.",
} satisfies Record<
  "did-not-start" | "no-bubblewrap" | "no-seatbelt" | "user-namespaces-closed",
  string
>;
