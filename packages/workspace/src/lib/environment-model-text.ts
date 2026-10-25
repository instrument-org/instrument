import { FOLDER_VARIABLES } from "../constants";
import {
  type Environment,
  type EnvironmentChange,
} from "../schemas/environment";
import { TOOL_NAMES } from "../tools/name";
import { systemNote } from "./system-note";

/**
 * A time zone by its region's name ("Central Time") rather than its IANA id
 * ("America/Chicago"): the id names a city the user may not live in, and a
 * model told it repeats the city as theirs. An id the runtime cannot name is
 * given as it is.
 */
export function timeZoneRegion(timeZone: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "longGeneric",
      })
        .formatToParts(new Date())
        .find((part) => part.type === "timeZoneName")?.value ?? timeZone
    );
  } catch {
    return timeZone;
  }
}

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
 * What the session's system information says about the commands only this
 * computer's shell has and the image options, beside the computer itself.
 */
export function computerToolsText(environment: Environment): string {
  return [
    environment.commands,
    environment.imageOptions !== undefined &&
      `For \`${TOOL_NAMES.generateImage}\`: ${environment.imageOptions}`,
  ]
    .filter((line) => typeof line === "string" && line !== "")
    .join("\n");
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
    change.timeZone && `- Time zone: ${timeZoneRegion(change.timeZone)}`,
    change.homeFolder && `- The user's home folder: \`${change.homeFolder}\``,
    ...VARIABLE_FOLDERS.map(
      ([fact, name, variable]) =>
        change[fact] && `- ${name} (\`$${variable}\`): \`${change[fact]}\``,
    ),
    change.commands !== undefined &&
      (change.commands === ""
        ? "- Your shell has only the commands the bash tool lists."
        : `- Commands beyond the bash tool's list:\n${change.commands}`),
    change.imageOptions !== undefined &&
      `- For \`${TOOL_NAMES.generateImage}\`: ${change.imageOptions}`,
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
  } else if (VARIABLE_FOLDERS.some(([fact]) => change[fact] !== undefined)) {
    // A file named earlier keeps the path it had when it was named, so after
    // the workspace moves an upload or a workspace file is under the new
    // folders rather than at that path.
    lines.push(
      "Paths named earlier in this conversation, such as the files the user sent, may point where these folders were before; look under the new ones instead.",
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
