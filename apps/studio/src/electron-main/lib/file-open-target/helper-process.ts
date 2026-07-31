import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LOOKUP_TIMEOUT_MS = 10_000;

// Lookups are interpreter-bound: osascript on CPU and LaunchServices, and
// PowerShell on a cold start that JITs the .NET runtime. A file grid can mount
// many open buttons at once, and letting every distinct extension spawn its own
// interpreter pushes them all past LOOKUP_TIMEOUT_MS together.
const MAX_CONCURRENT_LOOKUPS = 2;

let activeLookups = 0;
const lookupQueue: (() => void)[] = [];

// Runs a helper process directly. Used by the platform resolvers whose
// interpreter is cheap enough to start once per request.
export async function runHelper({
  args,
  file,
  maxBuffer,
}: {
  args: string[];
  file: string;
  maxBuffer?: number;
}) {
  const { stdout } = await execFileAsync(file, args, {
    maxBuffer,
    timeout: LOOKUP_TIMEOUT_MS,
    // Every resolver runs a console program, and on Windows each one is given a
    // console window of its own unless this is set: the lookups behind a file
    // grid would pop up a command prompt each.
    windowsHide: true,
  });
  return stdout;
}

// Runs a helper process behind the shared concurrency cap. Used by the macOS
// and Windows resolvers, which can otherwise be triggered once per distinct
// extension by a single file grid.
export async function runThrottledHelper(options: {
  args: string[];
  file: string;
  maxBuffer?: number;
}) {
  return withLookupSlot(() => runHelper(options));
}

async function withLookupSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeLookups >= MAX_CONCURRENT_LOOKUPS) {
    await new Promise<void>((resolve) => lookupQueue.push(resolve));
  } else {
    activeLookups++;
  }
  try {
    return await run();
  } finally {
    // Hand the slot straight to the next waiter instead of releasing it, so the
    // counter never dips and admits an extra caller during the handoff.
    const next = lookupQueue.shift();
    if (next) {
      next();
    } else {
      activeLookups--;
    }
  }
}
