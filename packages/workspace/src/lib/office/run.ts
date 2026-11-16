import path from "node:path";

import { writeRuntimeFile } from "../capabilities/runtime-file";
import { runtimeLayout } from "../runtime-dir";
import { execShim } from "../shell-commands/exec-shim";
import { getWorkspaceConfig } from "../workspace-config";
import { downloadedOffice, type OfficeInstall, ownOffice } from "./install";
import { freshProfile } from "./profile";

/**
 * Each `soffice` holds a few hundred MB while it runs, and a profile per
 * call lets calls run side by side, so at most this many run at once.
 */
const MAX_RUNNING = 2;

let running = 0;
const waiting: (() => void)[] = [];

async function slot(): Promise<() => void> {
  if (running >= MAX_RUNNING) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running++;
  return () => {
    running--;
    waiting.shift()?.();
  };
}

/** Whether a call names its own profile, which is then left as it is. */
export function namesProfile(args: readonly string[]): boolean {
  return args.some((arg) => arg.startsWith("-env:UserInstallation="));
}

/**
 * `soffice` with `args`, headless, with a fresh copy of the app's profile
 * in `tempRoot` unless the call names one, held to the chat's rules like
 * every native command.
 */
export async function runSoffice(
  install: OfficeInstall,
  args: readonly string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    signal?: AbortSignal;
    tempRoot: string;
  },
) {
  const release = await slot();
  const profile = namesProfile(args)
    ? undefined
    : await freshProfile(install.profileTemplate, options.tempRoot);
  try {
    return await execShim(
      install.soffice,
      [
        ...(profile ? [`-env:UserInstallation=${profile.url}`] : []),
        "--headless",
        "--norestore",
        "--nologo",
        "--nolockcheck",
        ...args,
      ],
      {
        cancelSignal: options.signal,
        cwd: options.cwd,
        env: options.env,
        stdin: "ignore",
      },
    );
  } finally {
    await profile?.dispose();
    release();
  }
}

/** A path as a single-quoted `sh` word. */
function shQuote(text: string) {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * The `soffice` every program the app starts finds first on its PATH: the
 * installed one with a fresh copy of the app's profile for each call that
 * names none, so a script a model wrote from memory, or the powerpoint
 * skill's `thumbnail.py`, runs as written.
 */
export function sofficeWrapper(
  install: Pick<OfficeInstall, "profileTemplate" | "soffice">,
  platform: NodeJS.Platform = process.platform,
): { content: string; name: string } {
  if (platform === "win32") {
    const template = install.profileTemplate.replaceAll("%", "%%");
    const soffice = install.soffice.replaceAll("%", "%%");
    return {
      content: [
        "@ECHO OFF",
        "SETLOCAL",
        'SET "OFFICE_PROFILE=%TEMP%\\office-profile-%RANDOM%%RANDOM%"',
        `XCOPY /E /I /Q /Y "${template}" "%OFFICE_PROFILE%" >NUL`,
        'SET "OFFICE_PROFILE_URL=%OFFICE_PROFILE:\\=/%"',
        `"${soffice}" "-env:UserInstallation=file:///%OFFICE_PROFILE_URL%" %*`,
        'SET "OFFICE_STATUS=%ERRORLEVEL%"',
        'RMDIR /S /Q "%OFFICE_PROFILE%"',
        "EXIT /B %OFFICE_STATUS%",
        "",
      ].join("\r\n"),
      name: "soffice.cmd",
    };
  }
  const soffice = shQuote(install.soffice);
  return {
    content: [
      "#!/bin/sh",
      'for arg in "$@"; do',
      `  case "$arg" in -env:UserInstallation=*) exec ${soffice} "$@" ;; esac`,
      "done",
      'profile=$(mktemp -d "${TMPDIR:-/tmp}/office-profile.XXXXXX") || exit 1',
      `cp -R ${shQuote(`${install.profileTemplate}/.`)} "$profile/" 2>/dev/null`,
      `${soffice} "-env:UserInstallation=file://$profile" "$@"`,
      "status=$?",
      'rm -rf "$profile"',
      'exit "$status"',
      "",
    ].join("\n"),
    name: "soffice",
  };
}

/** Writes the `soffice` wrapper into the runtime folder's `bin/`. */
export async function linkSoffice(install: OfficeInstall): Promise<void> {
  const { content, name } = sofficeWrapper(install);
  await writeRuntimeFile(
    path.join(runtimeLayout(getWorkspaceConfig().runtimeDir).bin, name),
    content,
    0o755,
  );
}

/**
 * At launch: the wrapper again where a LibreOffice is installed, since the
 * app makes its `bin/` links anew whenever they change.
 */
export async function linkOfficeIfInstalled(): Promise<void> {
  const install = downloadedOffice() ?? (await ownOffice());
  if (install) {
    await linkSoffice(install);
  }
}
