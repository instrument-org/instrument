import { FOLDER_VARIABLES } from "../constants";
import {
  type Environment,
  type EnvironmentChange,
} from "../schemas/environment";
import { systemNote } from "./system-note";

/** The folders the system prompt names by variable, and what each is called. */
const VARIABLE_FOLDERS = [
  ["outputFolder", "The output folder", FOLDER_VARIABLES.output],
  ["appsFolder", "The apps folder", FOLDER_VARIABLES.apps],
  [
    "workspaceSkillsFolder",
    "The workspace's skills folder",
    FOLDER_VARIABLES.workspaceSkills,
  ],
] as const satisfies [keyof Environment, string, string][];

/**
 * What working on this platform asks of the agent, beyond what every
 * computer does: the Mac's own apps as a place things can go, and Windows
 * paths. Told in the system information, and again when a chat moves to a
 * computer on another platform, never in the system prompt, which reads the
 * same on every computer.
 */
export function platformGuidance(platform: string): string | undefined {
  switch (platform) {
    case "darwin": {
      return "The Mac's own apps (Reminders, Calendar, Notes) are among the places a reminder, an event, or a note can go.";
    }
    case "win32": {
      return "The shell spells a Windows path the POSIX way (`C:\\Users\\sam` is `/c/Users/sam`); when you name a path to the user, write it the Windows way. Paths you pass a program as arguments are converted, but paths written inside a script's own code are not: write those the Windows way. `/tmp` in the shell is the temp folder (`%TEMP%`); a script gets it from its language (`tempfile.gettempdir()`, `os.tmpdir()`, `$env:TEMP`) rather than writing `/tmp`. `tasklist` lists every process on the computer; a program you start (PowerShell's `Get-Process` included) may see only its own.";
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Where the folders the system prompt names by variable are on this computer,
 * for the system information. A tool that takes a path reads no variable, so
 * the agent needs them written out too.
 */
export function folderVariablesText(environment: Environment): string {
  const folders = VARIABLE_FOLDERS.map(
    // Quoted, since a conversation's folder is named for it and can hold
    // spaces and commas that would otherwise run into the next one.
    ([fact, , variable]) => `\`$${variable}\` is \`${environment[fact]}\``,
  ).join(", ");
  return `On this computer ${folders}. Write a path out in full where a tool takes one, since only the shell reads a variable.`;
}

/**
 * Tells the model which facts about its computer changed since the session's
 * system information was written: the chat moved to another computer, the OS
 * updated, the time zone or a folder moved.
 *
 * The system information is never rewritten, so this supersedes it rather
 * than replacing it, and everything cached behind it stays cached.
 */
export function environmentChangeModelNote(
  change: EnvironmentChange,
): null | string {
  const facts = [
    change.computer && `- The computer: ${change.computer}`,
    change.timeZone && `- Time zone: ${change.timeZone}`,
    change.homeFolder && `- The user's home folder: \`${change.homeFolder}\``,
    ...VARIABLE_FOLDERS.map(
      ([fact, name, variable]) =>
        change[fact] && `- ${name} (\`$${variable}\`): \`${change[fact]}\``,
    ),
  ].filter((fact) => typeof fact === "string");
  if (facts.length === 0) {
    return null;
  }

  const lines = [
    "These facts about the computer changed since the system information above was written, which they supersede:",
    ...facts,
  ];
  if (change.computer !== undefined || change.homeFolder !== undefined) {
    lines.push(
      "Paths named earlier in this conversation may belong to the computer it ran on before; check one before you rely on it.",
    );
  }
  const guidance =
    change.platform === undefined
      ? undefined
      : platformGuidance(change.platform);
  if (guidance !== undefined) {
    lines.push(guidance);
  }

  return systemNote`
    ${lines.join("\n")}
  `;
}
