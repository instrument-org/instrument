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

export async function resolveWin32Target(
  fullPath: string,
): Promise<null | ResolvedApp> {
  const ext = path.extname(fullPath).toLowerCase();
  // The extension is interpolated into the script; only allow simple ones.
  if (!/^\.[a-z0-9]+$/.test(ext)) {
    return null;
  }
  // cspell:ignore HKCR HKCU
  // UserChoice is how Windows 10+ records the user's "always open with" pick;
  // the HKCR default is the pre-UserChoice fallback.
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$ext = '${ext}'
$progId = (Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\$ext\\UserChoice").ProgId
if (-not $progId) { $progId = (Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\\$ext").'(default)' }
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
    iconUrl: icon ? await storeFileOpenNativeImage(icon) : null,
  };
}
