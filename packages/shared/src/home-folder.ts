/**
 * Every way a home folder's path is written in text the app keeps or sends,
 * longest first so a caller replacing them in order takes the whole of each.
 *
 * On Windows one folder has several spellings: its own (`C:\Users\sam`), with
 * forward slashes as in a `file:///C:/Users/sam/…` stack frame, the shell's
 * (`/c/Users/sam`), escaped inside JSON (`C:\\Users\\sam`), and each with the
 * drive letter in either case. Elsewhere it has one.
 */
export function homeSpellings(home: string): string[] {
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(home);
  if (!drive) {
    return home ? [home] : [];
  }
  const [, letter = "", rest = ""] = drive;
  const parts = rest.split(/[\\/]+/).filter(Boolean);
  const spellings = [letter.toUpperCase(), letter.toLowerCase()].flatMap(
    (cased) => [
      `${cased}:\\\\${parts.join("\\\\")}`,
      `${cased}:\\${parts.join("\\")}`,
      `${cased}:/${parts.join("/")}`,
      `/${cased}/${parts.join("/")}`,
    ],
  );
  return [...new Set(spellings)].toSorted((a, b) => b.length - a.length);
}
