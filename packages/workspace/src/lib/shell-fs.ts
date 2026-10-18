import { type IFileSystem } from "just-bash";

import { type Listings } from "./permissions/rules-fs";
import { createWalkBudget, type WalkBudget } from "./walk-budget";
import { buildBashFs, type WorkspaceFsLayout } from "./workspace-fs-layout";

/**
 * FS reads, HTTP bodies, maxStringLength, and what one pipeline may carry
 * (`maxOutputSize`); maxHeredocSize unchanged (64 MiB). Pipelines buffer
 * rather than stream, so a file passes through `cat big.csv | wc -l` whole, and
 * an output bound below the read bound fails a file the agent may read. The
 * shell runs in a worker thread, so carrying it costs the window nothing.
 */
export const SANDBOX_MAX_BYTES = 256 * 1024 * 1024;

/**
 * The same budget for walks over a folder that holds the app's own data
 * (the user's whole home folder), counted on their own (`WalkBudget`). A stray
 * `find` over the home folder is the likeliest runaway walk there is, and the
 * budget counts entries rather than time: 300,000 of them costs a few
 * seconds of `find` on macOS and over half a minute on Windows, all on the
 * thread that paints the window.
 */
const HOME_MAX_TRAVERSAL = 20_000;

/**
 * The filesystem the agent's shell runs against, built from a session's
 * layout: every folder it reaches mounted at its real path, each held to
 * the rules (`rulesFs`). The shell builds one for each bash call and each
 * file tool one for each call, so `read_file` and `cat` read the same files,
 * are refused the same paths with the same note, and spell a path the same
 * way.
 */
export async function shellFs(layout: WorkspaceFsLayout): Promise<{
  fs: IFileSystem;
  /** The home folder's own walk budget, which the shell resets per command. */
  homeWalkBudget: WalkBudget;
  /**
   * The listings the command running now has made: a first one is named,
   * and its refusal says what to ask for where the rules ask first; a later
   * one is a walk passing through.
   */
  listings: Listings;
  /**
   * What the rules said each time they refused a path, with the path
   * spelled out, since an error that crosses just-bash's sanitizer loses it.
   */
  refusals: Set<string>;
}> {
  // The working folder walks at the sandbox's budget, and the home folder at
  // its own, smaller one.
  const homeWalkBudget = createWalkBudget(HOME_MAX_TRAVERSAL);
  const refusals = new Set<string>();
  const listings: Listings = { count: 0 };
  const fs = await buildBashFs(layout, {
    homeWalkBudget,
    listings,
    maxFileReadSize: SANDBOX_MAX_BYTES,
    onRefusal: (refusal) => refusals.add(refusal),
  });
  return { fs, homeWalkBudget, listings, refusals };
}
