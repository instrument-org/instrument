/** Windows 11 kept the 10.0 version; its builds start here. */
const FIRST_WINDOWS_11_BUILD = 22_000;

/**
 * The build in a Windows version ("10.0.26200"), which `os.release()` and
 * `process.getSystemVersion()` both give.
 */
export function windowsBuild(version: string): number | undefined {
  const [major, , build] = version.split(".").map(Number);
  return major === 10 && Number.isInteger(build) ? build : undefined;
}

/** "Windows 11" or "Windows 10" by build, since both report themselves as 10.0. */
export function windowsName(version: string): string {
  const build = windowsBuild(version);
  if (build === undefined) {
    return `Windows ${version}`;
  }
  return build >= FIRST_WINDOWS_11_BUILD ? "Windows 11" : "Windows 10";
}
