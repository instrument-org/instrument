import { type RPCOutput } from "@/client/rpc/client";

export type Release = RPCOutput["releases"]["list"]["releases"][number];

/**
 * Which releases the page shows in full and which folded, from the newest
 * first list. Opened after an update (`since`), every version between the one
 * left and the one running is in full, set apart from the rest; otherwise only the
 * running one is. Newer releases than that sit above it folded, except one
 * already downloaded, which the page leads with on its own.
 */
export function planPage(
  releases: Release[],
  {
    current,
    since,
    staged,
  }: {
    current: string | undefined;
    since: string | undefined;
    staged: string | undefined;
  },
) {
  const indexOf = (version: string | undefined) =>
    version === undefined
      ? -1
      : releases.findIndex((release) => release.version === version);
  // A build with no release of its own, a dev run's, reads as the newest.
  const at = Math.max(indexOf(current), 0);
  const left = indexOf(since);
  const fresh = left > at + 1;
  const end = fresh ? left : at + 1;
  return {
    current: releases[at]?.version === current ? current : undefined,
    folded: releases.slice(end),
    fresh,
    full: releases.slice(at, end),
    newer: releases
      .slice(0, at)
      .filter((release) => release.version !== staged),
    staged: releases.find((release) => release.version === staged),
  };
}

/** A beta by its line and number, as the notes speak of it; any other build by its version. */
export function versionLabel(version: string) {
  const beta = /^(?<line>\d+\.\d+)\.\d+-beta\.(?<n>\d+)$/.exec(version)?.groups;
  return beta?.line && beta.n
    ? `${beta.line} beta ${beta.n}`
    : `Version ${version}`;
}

/**
 * The notes below their opening paragraph, which the page shows on its own as
 * the lede. Notes with no summary are a commit list, shown whole.
 */
export function detailOf({ body, summary }: Release) {
  if (summary === null) {
    return body;
  }
  const heading = body.search(/^#{2,3}\s/m);
  return heading === -1 ? "" : body.slice(heading);
}
