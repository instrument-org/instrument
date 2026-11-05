import { execa } from "execa";
import { DefenseInDepthBox } from "just-bash";
import { sleep } from "radashi";
import { z } from "zod";

import { CapabilityFailure } from "../capabilities/define";

const StartAppsSchema = z.array(
  z.object({ AppID: z.string(), Name: z.string() }),
);
type StartApp = z.output<typeof StartAppsSchema>[number];

const ProgramSchema = z.object({
  description: z.string().nullish(),
  path: z.string(),
});
type Program = z.output<typeof ProgramSchema>;

const UTF8_OUTPUT = "[Console]::OutputEncoding = [Text.Encoding]::UTF8";

const LIST_START_APPS = `${UTF8_OUTPUT}; ConvertTo-Json -Compress -InputObject @(Get-StartApps | Select-Object Name, AppID)`;

const LIST_TIMEOUT_MS = 15_000;

/**
 * How long a card waits for an app's proper name. It goes by its program past
 * this, since `ask_permission` has a limit of its own and no card is worse.
 */
const DISPLAY_NAME_TIMEOUT_MS = 4000;

/** The names a refusal offers when none is the one asked for. */
const MAX_CLOSE_NAMES = 5;

let listed: StartApp[] | undefined;

function runPowerShell(script: string, timeout: number) {
  return DefenseInDepthBox.runTrustedAsync(() =>
    execa(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        reject: false,
        stdin: "ignore",
        timeout,
      },
    ),
  );
}

async function readStartMenu(): Promise<StartApp[]> {
  const result = await runPowerShell(LIST_START_APPS, LIST_TIMEOUT_MS);
  try {
    listed = StartAppsSchema.parse(JSON.parse(result.stdout));
    return listed;
  } catch {
    throw new CapabilityFailure(
      `the Start menu couldn't be read: ${String(result.stderr || result.shortMessage)}`,
    );
  }
}

function named(apps: StartApp[], given: string): StartApp | undefined {
  const wanted = given
    .trim()
    .replace(/\.exe$/i, "")
    .toLowerCase();
  return apps.find((app) => app.Name.toLowerCase() === wanted);
}

/**
 * The Start menu's app by its whole name, which is the name a person knows it
 * by. Reading the menu takes over a second, so the list is kept, and read again
 * only when it doesn't have the name: the app may be newly installed.
 */
export async function startMenuApp(
  given: string,
): Promise<StartApp | undefined> {
  return (
    (listed === undefined ? undefined : named(listed, given)) ??
    named(await readStartMenu(), given)
  );
}

/** The Start menu's names that contain `given`, for a refusal to offer. */
export async function closeStartMenuNames(given: string): Promise<string[]> {
  const wanted = given
    .trim()
    .replace(/\.exe$/i, "")
    .toLowerCase();
  return (listed ?? (await readStartMenu()))
    .map((app) => app.Name)
    .filter((name) => name.toLowerCase().includes(wanted))
    .slice(0, MAX_CLOSE_NAMES);
}

/**
 * The Start menu's entries for the package a program was installed from. Windows
 * installs one in `<name>_<version>_<arch>_<resource>_<publisher>`, and an entry's
 * AppID opens with `<name>_<publisher>!`.
 */
function entriesOfPackage(
  programPath: string,
  apps: readonly StartApp[],
): StartApp[] {
  const parts = /\\WindowsApps\\([^\\]+)\\/i.exec(programPath)?.[1]?.split("_");
  if (parts === undefined || parts.length < 3) {
    return [];
  }
  const family = `${parts[0]}_${parts.at(-1)}!`.toLowerCase();
  return apps.filter((app) => app.AppID.toLowerCase().startsWith(family));
}

/**
 * What a person calls a program. A packaged app's Start menu entry has its name,
 * where its file's description can be a file name (`mspaint.exe`) or nothing. A
 * package with several entries doesn't say which one this program is.
 */
export function programDisplayName(
  program: Program,
  apps: readonly StartApp[],
): string | undefined {
  const entries = entriesOfPackage(program.path, apps);
  const [entry] = entries;
  if (entry !== undefined && entries.length === 1) {
    return entry.Name;
  }
  const description = program.description?.trim() ?? "";
  return description === "" || /\.exe$/i.test(description)
    ? undefined
    : description;
}

async function lookUpDisplayName(pid: number): Promise<string | undefined> {
  const result = await runPowerShell(
    `${UTF8_OUTPUT}; $path = (Get-Process -Id ${String(pid)}).Path; if ($path) { ConvertTo-Json -Compress -InputObject @{ description = (Get-Item -LiteralPath $path).VersionInfo.FileDescription; path = $path } }`,
    DISPLAY_NAME_TIMEOUT_MS,
  );
  const program = ProgramSchema.parse(JSON.parse(result.stdout));
  const packaged = program.path.toLowerCase().includes("\\windowsapps\\");
  return programDisplayName(
    program,
    !packaged
      ? []
      : listed !== undefined &&
          entriesOfPackage(program.path, listed).length > 0
        ? listed
        : await readStartMenu().catch(() => []),
  );
}

/**
 * The name a card shows for the process `pid`, or nothing where only its program
 * says what it is. It names the app and decides nothing: what a yes covers is the
 * program, since a file can describe itself however it likes.
 */
export function displayNameOfProcess(pid: number): Promise<string | undefined> {
  return DefenseInDepthBox.runTrustedAsync(() =>
    Promise.race([
      lookUpDisplayName(pid).catch(() => undefined),
      sleep(DISPLAY_NAME_TIMEOUT_MS).then(() => undefined),
    ]),
  );
}

/**
 * Starts `app` as its Start menu entry does. It's the one way that reaches both
 * a packaged app, which has no program to run directly, and a classic one.
 */
export async function openStartMenuApp(app: StartApp): Promise<void> {
  // Explorer reports failure however the launch goes, so what shows whether it
  // worked is the window that follows.
  await DefenseInDepthBox.runTrustedAsync(() =>
    execa("explorer.exe", [`shell:AppsFolder\\${app.AppID}`], {
      reject: false,
      stdin: "ignore",
    }),
  );
}
