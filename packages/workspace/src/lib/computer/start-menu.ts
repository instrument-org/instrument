import { execa } from "execa";
import { DefenseInDepthBox } from "just-bash";
import { z } from "zod";

import { CapabilityFailure } from "../capabilities/define";

const StartAppsSchema = z.array(
  z.object({ AppID: z.string(), Name: z.string() }),
);
type StartApp = z.output<typeof StartAppsSchema>[number];

const LIST_START_APPS =
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8; ConvertTo-Json -Compress -InputObject @(Get-StartApps | Select-Object Name, AppID)";

const LIST_TIMEOUT_MS = 15_000;

/** The names a refusal offers when none is the one asked for. */
const MAX_CLOSE_NAMES = 5;

let listed: StartApp[] | undefined;

async function readStartMenu(): Promise<StartApp[]> {
  const result = await DefenseInDepthBox.runTrustedAsync(() =>
    execa(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", LIST_START_APPS],
      { reject: false, stdin: "ignore", timeout: LIST_TIMEOUT_MS },
    ),
  );
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
