import { app } from "electron";
import path from "node:path";
import { z } from "zod";

import { storeFileOpenNativeImage } from "../app-protocol";
import { runThrottledHelper } from "./helper-process";
import { type ResolvedApp } from "./types";

const Win32ResultSchema = z.object({
  appName: z.string(),
  exePath: z.string(),
});

export async function resolveWin32BrowserTarget(): Promise<null | ResolvedApp> {
  return resolveAssociation("https");
}

export async function resolveWin32Target(
  fullPath: string,
): Promise<null | ResolvedApp> {
  const ext = path.extname(fullPath).toLowerCase();
  // The extension is interpolated into the script; only allow simple ones.
  if (!/^\.[a-z0-9]+$/.test(ext)) {
    return null;
  }
  return resolveAssociation(ext);
}

/**
 * The app Windows itself would launch for an extension or a URL scheme, and
 * its display name, from the shell's own association lookup. Reading the
 * registry by hand (UserChoice, then the ProgId's open command) gets this
 * wrong where a browser has taken over another's ProgId, which is how a
 * ChromeHTML choice can open Brave.
 */
async function resolveAssociation(assoc: string) {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace InstrumentShell -Name Assoc -MemberDefinition '[DllImport("Shlwapi.dll", CharSet = CharSet.Unicode)] public static extern uint AssocQueryString(uint flags, uint str, string pszAssoc, string pszExtra, [Out] System.Text.StringBuilder pszOut, ref uint pcchOut);'
function Query([uint32]$what) {
  $size = [uint32]1024
  $out = New-Object System.Text.StringBuilder 1024
  if ([InstrumentShell.Assoc]::AssocQueryString(0, $what, '${assoc}', 'open', $out, [ref]$size) -ne 0) { return $null }
  $out.ToString()
}
# ASSOCSTR_EXECUTABLE, then ASSOCSTR_FRIENDLYAPPNAME.
$exe = Query 2
if (-not $exe -or -not (Test-Path -LiteralPath $exe)) { exit }
$name = Query 4
if (-not $name) { $name = (Get-Item -LiteralPath $exe).VersionInfo.FileDescription }
if (-not $name) { $name = [IO.Path]::GetFileNameWithoutExtension($exe) }
@{ appName = $name; exePath = $exe } | ConvertTo-Json -Compress
`;
  const stdout = await runThrottledHelper({
    args: ["-NoProfile", "-NonInteractive", "-Command", script],
    file: "powershell",
  });
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  const result = Win32ResultSchema.parse(JSON.parse(trimmed));
  // On Windows getFileIcon on the .exe does return the app icon.
  const icon = await app
    .getFileIcon(result.exePath, { size: "normal" })
    .catch(() => null);
  return {
    appName: result.appName,
    bundleId: null,
    iconUrl: icon ? await storeFileOpenNativeImage(icon) : null,
  };
}
