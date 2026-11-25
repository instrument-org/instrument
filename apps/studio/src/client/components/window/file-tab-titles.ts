import { rpcClient } from "@/client/rpc/client";
import { expandHomePath } from "@instrument-org/shared";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { safe } from "@orpc/client";

import { TITLED_NAME } from "./file-info";
import { matchScreen } from "./window-href";

type Hrefs = readonly (string | undefined)[];

/**
 * The titles the pages open in `hrefs` give themselves, by the file each
 * address names, read the way the List reads them, so a tab on a page is
 * named as its row is.
 */
export function useFileTabTitles(
  hrefs: Hrefs,
): Map<string, string> | undefined {
  const files = titledFilesOf(hrefs);
  const titles = useQuery({ ...titlesOf(files), enabled: files.length > 0 });
  return titles.data && byFile(files, titles.data);
}

/** The same titles, read now for one use rather than watched. */
export async function readFileTabTitles(
  queryClient: QueryClient,
  hrefs: Hrefs,
): Promise<Map<string, string> | undefined> {
  const files = titledFilesOf(hrefs);
  if (files.length === 0) return undefined;
  const { data } = await safe(queryClient.fetchQuery(titlesOf(files)));
  return data && byFile(files, data);
}

/** The files in `hrefs` a page may give a title of its own. */
function titledFilesOf(hrefs: Hrefs): string[] {
  return [
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
}

function titlesOf(files: readonly string[]) {
  const home = window.api.homeDir;
  return rpcClient.workspace.computer.titles.queryOptions({
    input: { paths: files.map((file) => expandHomePath(file, home)) },
    retry: false,
  });
}

/** The titles found, by each file as its address names it. */
function byFile(
  files: readonly string[],
  found: Record<string, string | null | undefined>,
): Map<string, string> {
  const home = window.api.homeDir;
  return new Map(
    files.flatMap((file) => {
      const title = found[expandHomePath(file, home)];
      return title ? [[file, title] as const] : [];
    }),
  );
}
