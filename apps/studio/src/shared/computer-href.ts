/**
 * The address of a file's tab: the folder view with the file open in it, by
 * where the file is on the computer. A page's file is shown as the page, and
 * `source` asks for its text instead. `tree` is the folder the tab's own
 * tree is rooted at, for a file opened from the Finder: the folder the
 * Finder was standing in.
 */
export function fileHref(
  hostPath: string,
  { source = false, tree }: { source?: boolean; tree?: string } = {},
) {
  return `/orchestrator/computer?file=${encodeURIComponent(hostPath)}&path=&root=~${source ? "&source=true" : ""}${tree === undefined ? "" : `&tree=${encodeURIComponent(tree)}`}`;
}

/**
 * The address of a folder's tab: the folder view standing in it.
 *
 * Rooted there rather than opened under the home folder, so the columns start
 * at the folder that was handed over instead of at the walk down to it. Takes
 * the path on the Mac, which is what the view is rooted by, and every other
 * way into a folder in this window -- a place on the home page, a path typed
 * into the omnibar -- arrives at the same address.
 */
export function folderHref(hostPath: string) {
  return `/orchestrator/computer?path=&root=${encodeURIComponent(hostPath)}`;
}
