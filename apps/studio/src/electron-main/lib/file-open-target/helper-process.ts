import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LOOKUP_TIMEOUT_MS = 10_000;

// osascript lookups are CPU- and LaunchServices-bound. A file grid can mount
// many open buttons at once, and letting every distinct extension spawn its own
// interpreter pushes them all past LOOKUP_TIMEOUT_MS together.
const MAX_CONCURRENT_LOOKUPS = 2;

let activeLookups = 0;
const lookupQueue: (() => void)[] = [];

// Runs a helper process directly. Used by the platform resolvers that spawn one
// short-lived process per request.
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
  });
  return stdout;
}

// Runs a helper process behind the shared concurrency cap. Used by the macOS
// resolvers, which can otherwise be triggered once per distinct extension by a
// single file grid.
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
