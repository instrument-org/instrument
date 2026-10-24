/**
 * Every way a home folder's path is written in text the app keeps or sends,
 * longest first so a caller replacing them in order takes the whole of each.
 *
 * On Windows one folder has several spellings: its own (`C:\Users\sam`), with
 * forward slashes as in a `file:///C:/Users/sam/…` stack frame, the shell's
 * (`/c/Users/sam`), escaped inside JSON (`C:\\Users\\sam`), and each with the
 * drive letter in either case. Elsewhere it has one. A spelling with
 * forward slashes also shows up percent-encoded where it is part of a
 * `file://` address, as a stack frame's is (`/Users/Jos%C3%A9%20Garc%C3%ADa`).
 */
export function homeSpellings(home: string): string[] {
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(home);
  if (!drive) {
    return home ? withEncoded([home]) : [];
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
  return withEncoded(spellings);
}

/** The spellings and their `file://` forms, each once, longest first. */
function withEncoded(spellings: string[]): string[] {
  const encoded = spellings
    .filter((spelling) => !spelling.includes("\\"))
    .map((spelling) => encodeURI(spelling));
  return [...new Set([...spellings, ...encoded])].toSorted(
    (a, b) => b.length - a.length,
  );
}
