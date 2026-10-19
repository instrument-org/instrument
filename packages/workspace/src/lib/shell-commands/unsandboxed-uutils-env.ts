import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The environment a uutils program gets when it runs outside the sandbox,
 * built from nothing rather than from the shell's: the sandbox is what kept
 * a variable the agent exported from reaching a file, so without it only
 * variables whose every value is known to be harmless pass.
 *
 * - The locale variables pick collation, number formats and the name of the
 *   message file, which uucore reads only from beside its own binary. Each
 *   passes only when it reads as a locale name, so the output matches the
 *   sandboxed run's.
 * - TZ passes only as a zone name: a path (`TZ=/etc/passwd`, `:path`) is a
 *   file jiff would read. TZDIR never passes.
 * - TMPDIR, TMP and TEMP are a folder of the app's own, where sort spills
 *   input past its buffer.
 * - NO_COLOR and TERM=dumb, and on Windows SystemRoot, which the C runtime
 *   needs to start.
 *
 * Nothing else: no PATH, no DYLD_* or LD_*, no POSIXLY_CORRECT or
 * _POSIX2_VERSION (they change how arguments parse, and the classifier has
 * to be the one that reads them), no GREP_COLOR(S), UUTILS_*, RUST_* or
 * QUOTING_STYLE.
 */

const LOCALE_NAMES = [
  "LANG",
  "LC_ALL",
  "LC_COLLATE",
  "LC_CTYPE",
  "LC_NUMERIC",
  "LC_TIME",
  "LC_MESSAGES",
] as const;

const LOCALE =
  /^(?:[A-Za-z]{2,3}(?:_[A-Z]{2})?(?:\.[A-Za-z0-9-]+)?(?:@\w+)?|C(?:\.UTF-8)?|POSIX)$/;

/** A zone name: segments of letters, digits, `_`, `+` and `-`, no path. */
const ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/** Whether `value` names a time zone rather than a file. */
export function isZoneName(value: string): boolean {
  if (!ZONE.test(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

let ownTemp: string | undefined;

/** The app's folder for what an unsandboxed program writes: sort's spill. */
function unsandboxedTempDir(): string {
  if (ownTemp === undefined) {
    const dir = path.join(os.tmpdir(), "instrument-uutils");
    mkdirSync(dir, { mode: 0o700, recursive: true });
    ownTemp = dir;
  }
  return ownTemp;
}

/**
 * The environment for an unsandboxed uutils program, from `env`, the one
 * the sandboxed run would have had. Names compare without case, as on
 * Windows.
 */
export function unsandboxedEnv(
  env: Readonly<Record<string, string | undefined>>,
  {
    platform = process.platform,
    systemRoot = () => process.env.SystemRoot,
    tempDir = unsandboxedTempDir,
  }: {
    platform?: NodeJS.Platform;
    systemRoot?: () => string | undefined;
    tempDir?: () => string;
  } = {},
): Record<string, string> {
  const named = (name: string) => {
    const key = Object.keys(env).find(
      (each) => each.toUpperCase() === name.toUpperCase(),
    );
    return key === undefined ? undefined : env[key];
  };
  const fixed: Record<string, string> = {};
  for (const name of LOCALE_NAMES) {
    const value = named(name);
    if (value !== undefined && LOCALE.test(value)) {
      fixed[name] = value;
    }
  }
  const zone = named("TZ");
  if (zone !== undefined && isZoneName(zone)) {
    fixed.TZ = zone;
  }
  const temp = tempDir();
  fixed.TMPDIR = temp;
  fixed.TMP = temp;
  fixed.TEMP = temp;
  fixed.NO_COLOR = "1";
  fixed.TERM = "dumb";
  // The app's own, never one the agent exported.
  const root = systemRoot();
  if (platform === "win32" && root !== undefined) {
    fixed.SystemRoot = root;
  }
  return fixed;
}
