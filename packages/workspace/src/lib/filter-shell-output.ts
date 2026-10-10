import os from "node:os";

import { type ChatDir } from "../schemas/paths";
import { normalizePath } from "./normalize-path";
import { nonTaskMounts, type WorkspaceFsLayout } from "./workspace-fs-layout";

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
 * `rewriteSeparators` turns every backslash in the output into a forward slash,
 * so paths printed by a Windows-native tool stay usable as tool path inputs. It
 * cannot tell a separator from any other backslash, so it also rewrites escape
 * sequences, regex literals, and matched file contents: JSON printed by a
 * script comes back with every `\n` spelled `/n`, which reads as corrupted
 * data and sends an agent hunting for the corruption. So it defaults on only
 * where those paths exist. On a posix host every backslash in output is
 * content, and callers there whose output is already POSIX pass false anyway.
 */
export function filterShellOutput(
  output: string,
  layout: WorkspaceFsLayout,
  {
    rewriteSeparators = process.platform === "win32",
  }: { rewriteSeparators?: boolean } = {},
): string {
  let filtered = virtualizeHostPaths(output, layout);

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

  if (rewriteSeparators) {
    filtered = filtered.replaceAll("\\", "/");
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

/**
 * The text with every host path the layout knows written the way the agent
 * reaches it: each mount's root as its mount point (`/mnt/Docs`, `/skills/...`,
 * `/tasks/<id>`), the task's own folder as `.`, and the home folder as `~`.
 * The one rewrite every command's output goes through, foreground and
 * streamed, so a path reads the same whichever printed it.
 *
 * Every spelling of each root is matched ({@link pathVariants}), without
 * case, longest first in one pass: a mount inside the home folder is named as
 * the mount rather than as `~/...`, which resolves to nothing in the sandbox,
 * and the task folder inside a mount is named as `.`. A root is matched only
 * where the name it ends in ends too, so `/Users/x/Docs` is not read inside
 * `/Users/x/Docs2`; `~` stands for anything left under the home folder.
 *
 * The home folder is folded only here, never in a file's contents (see
 * {@link redactTaskDir}), since a file may hold an absolute home path the
 * agent then edits or reports back.
 */
export function virtualizeHostPaths(
  text: string,
  layout: WorkspaceFsLayout,
): string {
  let rewrite = rewrites.get(layout);
  if (rewrite === undefined) {
    const home = os.homedir();
    rewrite = rootRewrite([
      ...nonTaskMounts(layout).map((mount) => ({
        root: mount.hostRoot,
        to: mount.mountPoint,
      })),
      { root: layout.task.hostRoot, to: "." },
      ...(home ? [{ root: home, to: "~" }] : []),
    ]);
    rewrites.set(layout, rewrite);
  }
  return rewrite(text);
}

/**
 * Collapse the task dir to "." wherever it appears. Safe for file contents: a
 * full task-dir path in a file is essentially always a leak (a script resolved
 * an absolute path via `.resolve()` / `__file__`), never legitimate content, so
 * redacting it can't mangle a path the agent needs to read or edit verbatim.
 */
export function redactTaskDir(text: string, dir: ChatDir): string {
  return rootRewrite([{ root: dir, to: "." }])(text);
}

/** One rewrite per layout, built the first time the layout's output is seen. */
const rewrites = new WeakMap<WorkspaceFsLayout, (text: string) => string>();

/**
 * A rewrite of each root, in every spelling, to what it stands for, longest
 * spelling first and in one pass, so nothing a root became is read again as
 * part of another.
 */
function rootRewrite(
  roots: { root: string; to: string }[],
): (text: string) => string {
  const targets = new Map<string, string>();
  for (const { root, to } of roots) {
    for (const variant of pathVariants(root)) {
      const key = variant.toLowerCase();
      if (!targets.has(key)) {
        targets.set(key, to);
      }
    }
  }
  if (targets.size === 0) {
    return (text) => text;
  }
  const pattern = new RegExp(
    `(?:${[...targets.keys()]
      .toSorted((a, b) => b.length - a.length)
      .map((variant) => escapeRegExp(variant))
      .join("|")})(?![\\p{L}\\p{N}_-])`,
    "giu",
  );
  return (text) =>
    text.replaceAll(
      pattern,
      (match) => targets.get(match.toLowerCase()) ?? match,
    );
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

function shouldFilter() {
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}
