/**
 * Which recently shown previews stay mounted, as one value: the paths in the
 * order they joined (reordering would churn their hosts' registrations) and
 * when each was last shown. `admitPreview` and `attachedPreviews` are pure;
 * the browser keeps the DOM each path renders into.
 */
export type PreviewPool = {
  /** Ticks once per admission, so a later admission always ranks newer. */
  clock: number;
  /** In the order they joined. */
  paths: readonly string[];
  /** The `clock` each path was last admitted at. */
  shownAt: ReadonlyMap<string, number>;
};

export const EMPTY_PREVIEW_POOL: PreviewPool = {
  clock: 0,
  paths: [],
  shownAt: new Map(),
};

/**
 * `path` admitted as the newest shown, past `size` evicting the one shown
 * longest ago. Always a new pool, so an admission always renders: a
 * container made for the path just before it is placed by the commit that
 * follows.
 */
export function admitPreview(
  pool: PreviewPool,
  path: string,
  size: number,
): PreviewPool {
  const clock = pool.clock + 1;
  const shownAt = new Map(pool.shownAt).set(path, clock);
  let paths = pool.paths.includes(path) ? pool.paths : [...pool.paths, path];
  if (paths.length > size) {
    const evicted = paths.reduce((oldest, candidate) =>
      (shownAt.get(candidate) ?? 0) < (shownAt.get(oldest) ?? 0)
        ? candidate
        : oldest,
    );
    shownAt.delete(evicted);
    paths = paths.filter((candidate) => candidate !== evicted);
  }
  return { clock, paths, shownAt };
}

/**
 * The paths whose previews stay attached to the page: the `count` shown most
 * recently, and the one open in the viewer dialog wherever it ranks.
 */
export function attachedPreviews(
  pool: PreviewPool,
  count: number,
  dialogPath: null | string,
): string[] {
  const attached = pool.paths
    .toSorted((a, b) => (pool.shownAt.get(b) ?? 0) - (pool.shownAt.get(a) ?? 0))
    .slice(0, count);
  if (
    dialogPath !== null &&
    pool.paths.includes(dialogPath) &&
    !attached.includes(dialogPath)
  ) {
    attached.push(dialogPath);
  }
  return attached;
}
