import path from "node:path";

/**
 * A program Windows ships, by its whole path in System32, which only an
 * administrator can write. Named bare, Windows looks in the working folder
 * and then each folder on the PATH first, so a program of the same name
 * there would run in its place, outside any sandbox.
 */
export function windowsSystemProgram(name: string): string {
  return path.win32.join(systemRoot(), "System32", `${name}.exe`);
}

/** Windows PowerShell by its whole path, for the same reason as {@link windowsSystemProgram}. */
export function windowsPowerShell(): string {
  return path.win32.join(
    systemRoot(),
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

function systemRoot(): string {
  return (
    Object.entries(process.env).find(
      ([key]) => key.toLowerCase() === "systemroot",
    )?.[1] ?? "C:\\Windows"
  );
}
