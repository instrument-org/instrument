/**
 * Scheme plus the userinfo that precedes `@` in a URL authority. Neither the
 * user nor the password segment may contain `/`, so a path segment ending in
 * `@` (`https://host/a@b`) cannot match. The user segment may be empty:
 * `https://:token@host` is the usual spelling for a token with no username.
 *
 * The scheme run is length-bounded, which is what keeps this linear. Unbounded,
 * the engine starts a greedy run at every character of every line and backtracks
 * the whole way looking for `://`, so cost grows with the square of the line
 * length: a 16 KB line of minified JS or base64 took ~400 ms, and a 64 KB one
 * several seconds.
 *
 * The bound does not narrow what is redacted. A match may still begin mid-token,
 * which is what covers a URL glued to the text before it (`-https://u:p@h`), and
 * `https` sits directly against `://`, so some start position inside the bound
 * always exists. Anchoring to a token boundary instead would be faster still and
 * would let exactly those glued spellings through.
 */
const URL_USERINFO_PATTERN =
  /([a-z][\w+.-]{0,31}:\/\/)[^\s/@:]*(?::[^\s/@]*)?@/gi;

/**
 * git's credential protocol writes `password=<secret>` on its own line, which
 * `git credential fill` prints to stdout.
 */
const CREDENTIAL_FIELD_PATTERN = /^(password|username)=.*$/gim;

/**
 * A drive-absolute Windows path a native tool printed (`C:\Users\sam\a.txt`,
 * `D:/data`, `C:\\Users\\sam` as a script escaped it), up to the first
 * character a path segment here cannot hold. A folder's name may hold spaces
 * (`C:\Program Files\x`) where a separator follows it; the last name may
 * not, so the sentence after a path stays out of it. `;` ends a path, since
 * it separates the entries of a Windows PATH.
 */
const DRIVE_PATH_PATTERN =
  /(?<![\w/\\])([A-Za-z]):((?:[\\/]+[^\\/"'<>|*?:;\r\n\t]+(?=[\\/]))*[\\/]+[^\s\\/"'<>|*?:;]*)/g;

/**
 * `rewriteSeparators` respells the drive-absolute paths a Windows-native tool
 * prints the way the shell spells them (`/c/Users/sam/a.txt`), so they stay
 * usable as the agent's next command's arguments. Only those: any other
 * backslash is content (an escape sequence, a regex, JSON a script printed)
 * and arrives as it was written. On by default only where those paths exist;
 * callers whose output is already POSIX pass false.
 */
export function filterShellOutput(
  output: string,
  {
    rewriteSeparators = process.platform === "win32",
  }: { rewriteSeparators?: boolean } = {},
): string {
  let filtered = output;

  // Redact credentials embedded in a URL's userinfo (`https://user:token@host`,
  // `https://token@host`), the form a token reaches git, curl, and package
  // managers in. Without this a token the agent put in a remote or a fetch URL
  // echoes back through progress output, `git remote -v`, and auth errors.
  // The pattern cannot match without `://`, and a scan for that literal is
  // several times cheaper than the regex on output of tens of megabytes.
  if (filtered.includes("://")) {
    filtered = filtered.replaceAll(URL_USERINFO_PATTERN, "$1***@");
  }
  filtered = filtered.replaceAll(CREDENTIAL_FIELD_PATTERN, "$1=***");

  if (rewriteSeparators && /[A-Za-z]:[\\/]/.test(filtered)) {
    filtered = filtered.replaceAll(
      DRIVE_PATH_PATTERN,
      (_, drive: string, rest: string) =>
        `/${drive.toLowerCase()}${rest.replaceAll(/[\\/]+/g, "/")}`.replace(
          /(.)\/$/,
          "$1",
        ),
    );
  }

  if (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test"
  ) {
    // Only the debugger lines go. Trimming the result as well would eat the
    // command's own trailing newline, running consecutive commands' output
    // together within one bash call, and would make dev/test output differ
    // from production for every command that routes through here.
    filtered = filtered
      .replaceAll(/^.*Debugger attached\..*$\n?/gm, "")
      .replaceAll(
        /^.*Waiting for the debugger to disconnect\.\.\..*$\n?/gm,
        "",
      );
  }

  return filtered;
}

/** A drive-absolute path spelled with `/` throughout (`C:/Users/sam/a.txt`). */
const SLASHED_DRIVE_PATH_PATTERN =
  /(?<![\w/\\])([A-Za-z]):((?:\/[^\\/"'<>|*?:;\r\n\t]+(?=\/))*\/[^\s\\/"'<>|*?:;]*)/g;

/**
 * The output of a tool told to print its paths with `/`, with the drive on
 * each of those paths respelled the way the shell spells it
 * (`C:/Users/sam/a.txt` as `/c/Users/sam/a.txt`), so a path it printed stays
 * usable as the next command's argument. A backslash is left alone wherever
 * it is, which is what keeps the escapes in a line the tool quoted from a
 * file, and in the JSON it wraps one in, as the file has them. The output as
 * it came on macOS and Linux, where a tool prints no drive.
 */
export function shellSpelledSlashedPaths(
  output: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32" || !/[A-Za-z]:\//.test(output)) {
    return output;
  }
  return output.replaceAll(
    SLASHED_DRIVE_PATH_PATTERN,
    (_, drive: string, rest: string) =>
      `/${drive.toLowerCase()}${rest}`.replace(/(.)\/$/, "$1"),
  );
}

export function shouldFilterDebuggerMessage(message: string): boolean {
  return (
    shouldFilter() &&
    (message.includes("Debugger attached.") ||
      message.includes("Waiting for the debugger to disconnect..."))
  );
}

function shouldFilter() {
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}
