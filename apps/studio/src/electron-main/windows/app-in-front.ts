import { logger } from "@/electron-main/lib/electron-logger";
import { BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LOOKUP_TIMEOUT_MS = 5000;

// The process owning the window Windows has in front. Compiling the two
// imports is most of PowerShell's ~350 ms here.
const FOREGROUND_PROCESS_SCRIPT = `
Add-Type -Namespace Instrument -Name Foreground -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);'
$owner = [uint32]0
[void][Instrument.Foreground]::GetWindowThreadProcessId([Instrument.Foreground]::GetForegroundWindow(), [ref]$owner)
$owner
`;

/**
 * Whether the app is in front of the person, from what Electron says and,
 * where it was asked, what the OS says.
 *
 * Electron's focus only ever errs toward focused: on Windows, a window that
 * asked to come forward while another app held the foreground is refused
 * the foreground but still made its thread's active window, so Electron,
 * and the page's `document.hasFocus()`, call it focused until it is brought
 * forward and left. An OS answer naming another process outranks it.
 * Without one (not asked, or the lookup failed), Electron's stands.
 */
export function readsAsInFront({
  electronFocused,
  foregroundProcessId,
  ownProcessId,
}: {
  electronFocused: boolean;
  foregroundProcessId: number | undefined;
  ownProcessId: number;
}) {
  if (!electronFocused) {
    return false;
  }
  return (
    foregroundProcessId === undefined || foregroundProcessId === ownProcessId
  );
}

/**
 * Whether the person has one of the app's windows in front of them. On
 * Windows this asks the OS, through a PowerShell start, but only when
 * Electron says a window has focus, since its "not focused" is right.
 * A window the main process puts up, the app's own and a native dialog
 * alike, belongs to this process.
 */
export async function isAppInFront(): Promise<boolean> {
  const electronFocused = BrowserWindow.getFocusedWindow() !== null;
  const foregroundProcessId =
    electronFocused && process.platform === "win32"
      ? await windowsForegroundProcessId()
      : undefined;
  return readsAsInFront({
    electronFocused,
    foregroundProcessId,
    ownProcessId: process.pid,
  });
}

async function windowsForegroundProcessId(): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        // Encoded, so the script's double quotes reach PowerShell intact.
        "-EncodedCommand",
        Buffer.from(FOREGROUND_PROCESS_SCRIPT, "utf16le").toString("base64"),
      ],
      { timeout: LOOKUP_TIMEOUT_MS, windowsHide: true },
    );
    const owner = Number.parseInt(stdout.trim(), 10);
    // 0, no window in front at all (a locked screen), is not this app.
    return Number.isInteger(owner) ? owner : undefined;
  } catch (error) {
    logger.warn("Could not ask Windows which app is in front", error);
    return undefined;
  }
}
