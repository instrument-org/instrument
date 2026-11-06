import { rpcClient } from "@/client/rpc/client";
import { expandHomePath } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";

import { TITLED_NAME } from "./file-info";
import { matchScreen } from "./window-href";

/**
 * The titles the pages open in `hrefs` give themselves, by the file each
 * address names, read the way the List reads them, so a tab on a page is
 * named as its row is.
 */
export function useFileTabTitles(
  hrefs: readonly (string | undefined)[],
): Map<string, string> | undefined {
  const files = [
    ...new Set(
      hrefs.flatMap((href) => {
        if (href === undefined) return [];
        const screen = matchScreen(href);
        return screen.kind === "computer" &&
          screen.file !== undefined &&
          TITLED_NAME.test(screen.file)
          ? [screen.file]
          : [];
      }),
    ),
  ].toSorted();
  const home = window.api.homeDir;
  const titles = useQuery({
    ...rpcClient.workspace.computer.titles.queryOptions({
      input: { paths: files.map((file) => expandHomePath(file, home)) },
      retry: false,
    }),
    enabled: files.length > 0,
  });
  const found = titles.data;
  if (!found) return undefined;
  return new Map(
    files.flatMap((file) => {
      const title = found[expandHomePath(file, home)];
      return title ? [[file, title] as const] : [];
    }),
  );
}
