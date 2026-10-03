import { type ViewerFile } from "@/client/atoms/task-file-viewer";
import { rpcClient } from "@/client/rpc/client";
import {
  skipToken,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { isMacOS } from "../lib/utils";

type FileRef = Pick<ViewerFile, "hostPath">;

const openTargetQueryOptions = (file: FileRef | undefined) =>
  rpcClient.utils.fileOpenTarget.queryOptions({
    input: file ? { filePath: file.hostPath } : skipToken,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

// The system's file manager: its path, and its own icon where the platform can
// render one (macOS). Fetched once for the session.
export function useFileManagerApp() {
  const { data } = useQuery(
    rpcClient.utils.fileManagerApp.queryOptions({
      input: isMacOS() ? undefined : skipToken,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  return data;
}

// Every app that can open the file, with the system's own choice carrying
// `isDefault` rather than a position. File viewers start this lookup
// immediately; contextual menus wait until opened.
const openCandidatesQueryOptions = (file: FileRef | undefined) =>
  rpcClient.utils.fileOpenCandidates.queryOptions({
    input: file ? { filePath: file.hostPath } : skipToken,
    // A successful list is cached for the session, but a failed lookup is
    // worth another attempt whenever a menu that needs it mounts.
    refetchOnMount: (query) => query.state.status === "error",
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
  });

export function useFileOpenCandidates(
  file: FileRef | undefined,
  { enabled }: { enabled: boolean },
) {
  const { data, isError, isPending } = useQuery(
    openCandidatesQueryOptions(enabled ? file : undefined),
  );

  return {
    apps: data?.apps ?? [],
    isError,
    isPending: enabled && file != null && isPending,
  };
}

// Default-app name and icon for a file, for "Open in {app}" affordances.
// Resolution is cached per file type in the main process (and persisted across
// runs); the query is cached per file here.
export function useFileOpenTarget(file: FileRef | undefined) {
  const { data, isPending } = useQuery(openTargetQueryOptions(file));

  const appName = data?.appName ?? null;
  const showOpen = file != null && !isPending && appName != null;

  return {
    appName,
    iconUrl: data?.iconUrl ?? null,
    isPending,
    openLabel: appName ? `Open in ${appName}` : "Open",
    showOpen,
    showOpenWith: showOpen && isMacOS(),
  };
}

// Warms the open-target query (e.g. on hover) so menus and the file viewer
// have the app name and icon ready by the time they render.
export function usePrefetchFileOpenTarget() {
  const queryClient = useQueryClient();
  return (file: FileRef) => {
    void queryClient.prefetchQuery(openTargetQueryOptions(file));
  };
}

/**
 * The apps that can open every one of several files, for a menu that opens
 * them together, the way the Finder's Open With lists them for a selection.
 * The system answers by type, so a file whose extension another has already
 * asked about is not asked again; one with no extension (a folder, a
 * Makefile) says nothing of the next and is asked about itself. An app is
 * the default only where it is the default for every one of them.
 */
export function useSharedFileOpenCandidates(
  files: readonly FileRef[],
  { enabled }: { enabled: boolean },
) {
  const seen = new Set<string>();
  const asked = files.filter((file) => {
    const extension = extensionOf(file.hostPath);
    if (!extension) {
      return true;
    }
    if (seen.has(extension)) {
      return false;
    }
    seen.add(extension);
    return true;
  });
  const results = useQueries({
    queries: asked.map((file) =>
      openCandidatesQueryOptions(enabled ? file : undefined),
    ),
  });
  const answers = results.flatMap((result) =>
    result.data ? [result.data.apps] : [],
  );
  const apps = answers.length < results.length ? [] : sharedApps(answers);
  return {
    apps,
    isError: results.some((result) => result.isError),
    isPending:
      enabled && files.length > 0 && results.some((result) => result.isPending),
  };
}

type OpenCandidate = {
  appName: string;
  appPath: string;
  iconUrl: null | string;
  isDefault: boolean;
};

/**
 * The apps in every one of several lists, in the first list's order, each the
 * default only where every list has it as the default.
 */
export function sharedApps(answers: readonly OpenCandidate[][]) {
  const [first = [], ...rest] = answers;
  return first
    .filter((app) =>
      rest.every((others) =>
        others.some((other) => other.appPath === app.appPath),
      ),
    )
    .map((app) => ({
      ...app,
      isDefault:
        app.isDefault &&
        rest.every((others) =>
          others.some(
            (other) => other.appPath === app.appPath && other.isDefault,
          ),
        ),
    }));
}

/** A path's extension, lowercased, or "" for a name without one. */
function extensionOf(hostPath: string) {
  const name = hostPath.split(/[/\\]/).at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}
