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

// UserChoice is how Windows 10+ records the user's "always open with" pick;
// the HKCR default is the pre-UserChoice fallback.
function win32FileProgIdLookup(ext: string) {
  return `
$progId = (Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice").ProgId
if (-not $progId) { $progId = (Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\\${ext}").'(default)' }
`;
}

// The default browser is the https handler the user picked; before per-user
// URL associations existed, the http class's own open command was the browser.
const WIN32_BROWSER_PROG_ID_LOOKUP = `
$associations = "HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations"
$progId = (Get-ItemProperty -Path "$associations\\https\\UserChoice").ProgId
if (-not $progId) { $progId = (Get-ItemProperty -Path "$associations\\http\\UserChoice").ProgId }
if (-not $progId) { $progId = 'http' }
`;

export async function resolveWin32BrowserTarget(): Promise<null | ResolvedApp> {
  return resolveProgId(WIN32_BROWSER_PROG_ID_LOOKUP);
}

export async function resolveWin32Target(
  fullPath: string,
): Promise<null | ResolvedApp> {
  const ext = path.extname(fullPath).toLowerCase();
  // The extension is interpolated into the script; only allow simple ones.
  if (!/^\.[a-z0-9]+$/.test(ext)) {
    return null;
  }
  return resolveProgId(win32FileProgIdLookup(ext));
}

// Runs a lookup that leaves `$progId` set, then follows the ProgId to the
// executable its open command runs and names it after the executable.
async function resolveProgId(progIdLookup: string) {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
${progIdLookup}
if (-not $progId) { exit }
$command = (Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\\$progId\\shell\\open\\command").'(default)'
if (-not $command) { exit }
$exe = if ($command -match '^"([^"]+)"') { $Matches[1] } else { ($command -split ' ')[0] }
$exe = [Environment]::ExpandEnvironmentVariables($exe)
if (-not (Test-Path -LiteralPath $exe)) { exit }
$name = (Get-Item -LiteralPath $exe).VersionInfo.FileDescription
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
