import type path from "node:path";

/**
 * A `~` alone or a `~/` at the start of a link's path, which is how a link
 * read on two computers names a folder under home on both, whatever the
 * person's name on each.
 */
const HOME = /^\/?~(?=\/|$)/;

/**
 * A link's path with a leading `~` read as the person's home folder, in the
 * link's own spelling (forward slashes, a `file/` link's leading slash taken
 * off as it is off a drive letter), so what follows is judged as a link
 * written absolute is. `~user` is nobody's home here and stays as written.
 */
export function fromHome(
  linkPath: string,
  home: string,
  hostPaths: path.PlatformPath,
): string {
  const tilde = HOME.exec(linkPath);
  if (tilde === null) {
    return linkPath;
  }
  const linkHome = (
    hostPaths.sep === "\\" ? home.replaceAll("\\", "/") : home
  ).replace(/\/+$/, "");
  return linkHome + linkPath.slice(tilde[0].length);
}
