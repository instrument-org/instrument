/**
 * Who would not let this app read a path, when a read was refused rather than
 * failing some other way.
 *
 * - `system`: the Mac's privacy controls (Files and Folders, Full Disk
 *   Access), which answer `EPERM`. The person undoes it by picking the folder
 *   in the system's own panel or allowing the app in System Settings.
 * - `account`: the file permissions of the account the app runs as, which
 *   answer `EACCES` (and `EPERM` everywhere but the Mac). Nothing in the app
 *   changes those.
 */
export type ReadRefusal = "account" | "system";

/** The refusal a failed read was, or undefined for any other failure. */
export function readRefusalOf(
  error: unknown,
  platform: NodeJS.Platform = process.platform,
): ReadRefusal | undefined {
  const code = error instanceof Error && "code" in error ? error.code : "";
  if (code === "EPERM") {
    return platform === "darwin" ? "system" : "account";
  }
  return code === "EACCES" ? "account" : undefined;
}
