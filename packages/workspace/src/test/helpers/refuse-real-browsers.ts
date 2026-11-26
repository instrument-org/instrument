import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";

// A unit test that starts the real agent-browser starts a real Chrome too, on
// every run of the suite and every agent turn that runs related tests. What a
// test needs from the CLI is recorded (script:record-agent-browser-output), and
// a stand-in for the binary that falls through to the real one fails here
// instead of opening a browser.
//
// The real agent-browser is the binary of its platform package; the app's own
// `agent-browser` in a runtime folder's bin is a script, and tests run it.
const BROWSER = [
  /@agent-browser[/\\]cli-[^/\\]+[/\\]bin[/\\]agent-browser(?:\.exe)?$/,
  /[/\\]chrome-headless-shell(?:\.exe)?$/,
  /(?:Chrome|Chromium)\.app[/\\]/,
];

/** The browser a launch names, as its program, a launcher's operand, or a word of a shell command. */
export function browserLaunchedBy(
  file: unknown,
  args: unknown,
): string | undefined {
  const operands: unknown[] = Array.isArray(args) ? args : [];
  const words = [file, ...operands].flatMap((word) =>
    typeof word === "string" ? [word, ...word.split(/\s+/)] : [],
  );
  return words.find((word) => BROWSER.some((pattern) => pattern.test(word)));
}

const GUARDED = Symbol("refuses real browsers");

const LAUNCHERS = [
  "exec",
  "execFile",
  "execFileSync",
  "execSync",
  "fork",
  "spawn",
  "spawnSync",
] as const;

function refuseBrowser(file: unknown, args: unknown) {
  const browser = browserLaunchedBy(file, args);
  if (browser !== undefined) {
    throw new Error(
      `A test started ${browser}, which opens a real browser. Read what it prints from a recording (script:record-agent-browser-output) or stub it.`,
    );
  }
}

/** `real`, refusing a browser first. */
function guard(real: (...args: unknown[]) => unknown) {
  return function (this: unknown, ...args: unknown[]) {
    refuseBrowser(args[0], args[1]);
    return Reflect.apply(real, this, args);
  };
}

/** Makes every way of starting a program throw when what it starts is a browser. */
export function refuseRealBrowsers() {
  for (const name of LAUNCHERS) {
    const real: unknown = childProcess[name];
    if (typeof real !== "function" || GUARDED in real) {
      continue;
    }
    const guarded = guard(real as (...args: unknown[]) => unknown); // A launcher takes any arguments.
    // `exec` and `execFile` carry the form `util.promisify` uses, which
    // resolves to `{ stdout, stderr }`; it is guarded the same way.
    for (const key of Reflect.ownKeys(real)) {
      const value: unknown = Reflect.get(real, key);
      Reflect.set(
        guarded,
        key,
        key === promisify.custom && typeof value === "function"
          ? guard(value as (...args: unknown[]) => unknown) // As above.
          : value,
      );
    }
    Reflect.set(guarded, GUARDED, true);
    Object.defineProperty(childProcess, name, {
      value: guarded,
      writable: true,
    });
  }
  syncBuiltinESMExports();
}
