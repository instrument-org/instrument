import os from "node:os";

import { type TaskDir } from "../schemas/paths";
import { normalizePath } from "./normalize-path";

/**
 * Scheme plus the userinfo that precedes `@` in a URL authority. Neither the
 * user nor the password segment may contain `/`, so a path segment ending in
 * `@` (`https://host/a@b`) cannot match. The user segment may be empty:
 * `https://:token@host` is the usual spelling for a token with no username.
 */
const URL_USERINFO_PATTERN = /([a-z][\w+.-]*:\/\/)[^\s/@:]*(?::[^\s/@]*)?@/gi;

/**
 * git's credential protocol writes `password=<secret>` on its own line, which
 * `git credential fill` prints to stdout.
 */
const CREDENTIAL_FIELD_PATTERN = /^(password|username)=.*$/gim;

export function filterShellOutput(output: string, dir: TaskDir): string {
  let filtered = redactHostPaths(output, dir);

  // Redact credentials embedded in a URL's userinfo (`https://user:token@host`,
  // `https://token@host`), the form a token reaches git, curl, and package
  // managers in. Without this a token the agent put in a remote or a fetch URL
  // echoes back through progress output, `git remote -v`, and auth errors.
  filtered = filtered.replaceAll(URL_USERINFO_PATTERN, "$1***@");
  filtered = filtered.replaceAll(CREDENTIAL_FIELD_PATTERN, "$1=***");

  // Keep agent-facing shell output consistent with tool path inputs.
  filtered = filtered.replaceAll("\\", "/");

  if (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test"
  ) {
    filtered = filtered
      .replaceAll(/^.*Debugger attached\..*$\n?/gm, "")
      .replaceAll(/^.*Waiting for the debugger to disconnect\.\.\..*$\n?/gm, "")
      .trim();
  }

  return filtered;
}

/**
 * Replace host filesystem paths with their sandbox-shaped forms: the task dir
 * becomes ".", the host home dir becomes "~". Keeps the host layout and the
 * username out of anything that re-enters the model or a user-facing
 * deliverable -- shell output (via filterShellOutput) and file contents read
 * back through read_file/grep. A script that calls `.resolve()` /
 * `os.path.abspath` can otherwise write a real host path into a file the agent
 * then reads.
 */
export function redactHostPaths(text: string, dir: TaskDir): string {
  let redacted = text;
  for (const variant of pathVariants(dir)) {
    redacted = redacted.replaceAll(
      new RegExp(escapeRegExp(variant), "gi"),
      ".",
    );
  }

  // The pnpm store/cache/dlx paths and tool stack traces sit beneath the home
  // dir. Runs after the task-dir pass so task paths still collapse to ".".
  const home = os.homedir();
  if (home) {
    for (const variant of pathVariants(home)) {
      redacted = redacted.replaceAll(
        new RegExp(escapeRegExp(variant), "gi"),
        "~",
      );
    }
  }

  return redacted;
}

export function shouldFilterDebuggerMessage(message: string): boolean {
  return (
    shouldFilter() &&
    (message.includes("Debugger attached.") ||
      message.includes("Waiting for the debugger to disconnect..."))
  );
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// macOS firmlinks: a resolved path under these roots canonicalizes to its
// /private-prefixed spelling (`/var/folders/...` -> `/private/var/folders/...`),
// so a task or home dir handed in one spelling must be redacted in the other.
const FIRMLINK_ROOTS = ["/var", "/tmp", "/etc"];

function firmlinkSpellings(value: string): string[] {
  const spellings = [value];
  for (const root of FIRMLINK_ROOTS) {
    if (value === root || value.startsWith(`${root}/`)) {
      spellings.push(`/private${value}`);
    }
    const priv = `/private${root}`;
    if (value === priv || value.startsWith(`${priv}/`)) {
      spellings.push(value.slice("/private".length));
    }
  }
  return spellings;
}

/**
 * Every spelling of a path that can appear in subprocess output or file
 * contents: as given, slash-normalized, backslash-separated, the string-escaped
 * form of each (printed error objects render Windows paths with doubled
 * backslashes -- `path: 'C:\\Users\\...'` -- which the plain variants never
 * match), and each macOS firmlink spelling of all the above.
 */
function pathVariants(value: string): string[] {
  const variants = new Set<string>();
  for (const spelling of firmlinkSpellings(value)) {
    const normalized = normalizePath(spelling);
    for (const form of [
      spelling,
      normalized,
      normalized.replaceAll("/", "\\"),
    ]) {
      variants.add(form);
      if (form.includes("\\")) {
        variants.add(form.replaceAll("\\", "\\\\"));
      }
    }
  }
  // Longest first so a shorter spelling (the bare `/var/...` form) never eats
  // into a longer one (its `/private/var/...` firmlink spelling) mid-replace.
  return [...variants].sort((a, b) => b.length - a.length);
}

function shouldFilter() {
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}
