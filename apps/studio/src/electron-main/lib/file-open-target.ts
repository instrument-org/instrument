import { app, nativeImage } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

export interface FileOpenTarget {
  appName: null | string;
  iconDataUrl: null | string;
}

const ICON_SIZE = 64;

// Association lookups spawn helper processes; the result only depends on the
// file type, so cache per extension for the app's lifetime.
const targetCache = new Map<string, Promise<FileOpenTarget>>();

export function getFileOpenTarget(fullPath: string) {
  const key = path.extname(fullPath).toLowerCase() || fullPath;
  const cached = targetCache.get(key);
  if (cached) {
    return cached;
  }
  const target = resolveTarget(fullPath);
  targetCache.set(key, target);
  return target;
}

// `app.getFileIcon` only yields the file-type icon (a generic icon for .app
// bundles), so app icons come from the per-platform resolvers instead.
async function getFileTypeIconDataUrl(fullPath: string) {
  try {
    const icon = await app.getFileIcon(fullPath, { size: "normal" });
    return icon.isEmpty() ? null : icon.toDataURL();
  } catch {
    return null;
  }
}

async function resolveAssociatedApp(
  fullPath: string,
): Promise<null | { appName: string; iconDataUrl: null | string }> {
  switch (process.platform) {
    case "darwin": {
      return resolveDarwin(fullPath);
    }
    case "linux": {
      return resolveLinux(fullPath);
    }
    case "win32": {
      return resolveWin32(fullPath);
    }
    default: {
      return null;
    }
  }
}

async function resolveTarget(fullPath: string): Promise<FileOpenTarget> {
  const resolved = await resolveAssociatedApp(fullPath).catch(() => null);
  const iconDataUrl =
    resolved?.iconDataUrl ?? (await getFileTypeIconDataUrl(fullPath));
  return { appName: resolved?.appName ?? null, iconDataUrl };
}

// Resolves the default app via NSWorkspace and returns its real icon
// (works for asset-catalog-only apps where reading the .icns would fail).
const DARWIN_RESOLVE_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  const ws = $.NSWorkspace.sharedWorkspace;
  const result = { appName: "", iconBase64: "" };
  try {
    const url = ws.URLForApplicationToOpenURL($.NSURL.fileURLWithPath(argv[0]));
    const appPath = url.path.js;
    if (!appPath) {
      return JSON.stringify(result);
    }
    result.appName =
      $.NSFileManager.defaultManager.displayNameAtPath(appPath).js ?? "";
    const rep = $.NSBitmapImageRep.imageRepWithData(
      ws.iconForFile(appPath).TIFFRepresentation,
    );
    const png = rep.representationUsingTypeProperties(
      $.NSBitmapImageFileTypePNG,
      $.NSDictionary.dictionary,
    );
    result.iconBase64 = png.base64EncodedStringWithOptions(0).js ?? "";
  } catch {
    // fall through with whatever resolved so far
  }
  return JSON.stringify(result);
}
`;

const DarwinResultSchema = z.object({
  appName: z.string(),
  iconBase64: z.string(),
});

function pngBase64ToDataUrl(base64: string) {
  if (!base64) {
    return null;
  }
  const image = nativeImage.createFromBuffer(Buffer.from(base64, "base64"));
  if (image.isEmpty()) {
    return null;
  }
  return image.resize({ height: ICON_SIZE, width: ICON_SIZE }).toDataURL();
}

async function resolveDarwin(fullPath: string) {
  const { stdout } = await execFileAsync(
    "osascript",
    ["-l", "JavaScript", "-e", DARWIN_RESOLVE_SCRIPT, fullPath],
    // The icon PNG can be ~1MB of base64 (icons ship at 1024px).
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const result = DarwinResultSchema.parse(JSON.parse(stdout));
  if (!result.appName) {
    return null;
  }
  return {
    appName: result.appName.replace(/\.app$/, ""),
    iconDataUrl: pngBase64ToDataUrl(result.iconBase64),
  };
}

const Win32ResultSchema = z.object({
  appName: z.string(),
  exePath: z.string(),
});

async function readDesktopEntryName(desktopId: string) {
  const dataDirs = [
    path.join(os.homedir(), ".local/share"),
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    ...(process.env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share").split(":"),
  ];
  for (const dir of dataDirs) {
    if (!dir) {
      continue;
    }
    try {
      const content = await fs.readFile(
        path.join(dir, "applications", desktopId),
        "utf8",
      );
      const name = /^Name=(.+)$/m.exec(content)?.[1]?.trim();
      if (name) {
        return name;
      }
    } catch {
      // not in this data dir; try the next one
    }
  }
  return null;
}

async function resolveLinux(fullPath: string) {
  const { stdout: mimeOut } = await execFileAsync("xdg-mime", [
    "query",
    "filetype",
    fullPath,
  ]);
  const mime = mimeOut.trim();
  if (!mime) {
    return null;
  }
  const { stdout: desktopOut } = await execFileAsync("xdg-mime", [
    "query",
    "default",
    mime,
  ]);
  const desktopId = desktopOut.trim();
  if (!desktopId || desktopId.includes("/")) {
    return null;
  }
  const appName = await readDesktopEntryName(desktopId);
  if (!appName) {
    return null;
  }
  // No portable icon-theme lookup; callers get the file-type icon instead.
  return { appName, iconDataUrl: null };
}

async function resolveWin32(fullPath: string) {
  const ext = path.extname(fullPath).toLowerCase();
  // The extension is interpolated into the script; only allow simple ones.
  if (!/^\.[a-z0-9]+$/.test(ext)) {
    return null;
  }
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
  const { stdout } = await execFileAsync("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
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
    iconDataUrl: icon && !icon.isEmpty() ? icon.toDataURL() : null,
  };
}
