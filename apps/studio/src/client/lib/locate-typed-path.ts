import {
  type TypedPath,
  typedPathOf,
  withoutTrailingSeparators,
} from "@/client/lib/typed-path";
import { type RPCOutput, rpcClient } from "@/client/rpc/client";
import { displayHostPath, expandHomePath } from "@instrument-org/shared";
import { safe } from "@orpc/client";

/** What is at a typed path, as the main process found it. */
export type LocatedPath = RPCOutput["workspace"]["computer"]["locate"];

/** A typed path that led nowhere it could open, and what the field says about it. */
export type MissedPath = Extract<LocatedPath, { kind: "failed" | "missing" }>;

/** {@link typedPathOf} for the computer the window is on. */
export function typedPathHere(words: string): TypedPath | undefined {
  return typedPathOf(words, window.electron.process.platform);
}

/** A typed path as its row names it: the home folder as `~` where people write it that way. */
export function shownTypedPath(path: TypedPath) {
  const home = window.api.homeDir;
  return displayHostPath(expandHomePath(path.shown, home), home);
}

/** How long a look for a path goes before the field says it is still looking. */
const SLOW_LOOK_MS = 250;

/**
 * What is at a typed path, asked once the person presses Return. A call
 * that fails is a read that failed, never a place that is there. A look
 * that takes long enough to notice (a drive on the network that is slow to
 * answer) calls `onSlow`, so the field can say it is looking rather than
 * seem to have ignored the key.
 */
export async function locateTypedPath(
  path: TypedPath,
  { onSlow }: { onSlow?: () => void } = {},
): Promise<LocatedPath> {
  const timer = onSlow ? setTimeout(onSlow, SLOW_LOOK_MS) : undefined;
  const [error, located] = await safe(
    rpcClient.workspace.computer.locate.call({ path: path.typed }),
  );
  clearTimeout(timer);
  return error ? { kind: "failed", path: path.shown } : located;
}

/** What a field says about a path it could not open, in a sentence. */
export function missedPathNotice(missed: MissedPath) {
  const shown = `“${displayHostPath(withoutTrailingSeparators(missed.path), window.api.homeDir)}”`;
  if (missed.kind === "missing") {
    return `There’s nothing at ${shown}.`;
  }
  // Windows has no code of its own for a share that can't be reached, so
  // the read fails as UNKNOWN; on a share, that is what it nearly always is.
  const why =
    (missed.code === undefined ? undefined : FAILURES[missed.code]) ??
    (missed.code === "UNKNOWN" && missed.path.startsWith("\\\\")
      ? "The network share it’s on isn’t answering."
      : undefined);
  return `Instrument couldn’t open ${shown}.${why ? ` ${why}` : ""}`;
}

/** The failures a person can do something about, said the way they would say them. */
const FAILURES: Partial<Record<string, string>> = {
  EBUSY: "Something else is using it right now.",
  EHOSTDOWN: "The drive it’s on isn’t answering.",
  EHOSTUNREACH: "The drive it’s on isn’t answering.",
  EIO: "The drive it’s on isn’t answering.",
  ELOOP: "The path loops back on itself.",
  ENAMETOOLONG: "The path is too long.",
  ENETUNREACH: "The drive it’s on isn’t answering.",
  ETIMEDOUT: "The drive it’s on isn’t answering.",
};
