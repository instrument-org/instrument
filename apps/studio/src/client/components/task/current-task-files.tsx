import { withAssetUrlVersion } from "@/client/lib/get-asset-url";
import { type RPCOutput } from "@/client/rpc/client";
import { createContext, type ReactNode, useContext } from "react";

type TaskFile = RPCOutput["workspace"]["task"]["files"]["list"][number];

const CurrentTaskFilesContext = createContext<
  ReadonlyMap<string, TaskFile> | undefined
>(undefined);

export function CurrentTaskFilesProvider({
  children,
  files,
}: {
  children: ReactNode;
  files: TaskFile[] | undefined;
}) {
  const filesByPath = files
    ? new Map(files.map((file) => [file.filePath, file]))
    : undefined;

  return (
    <CurrentTaskFilesContext value={filesByPath}>
      {children}
    </CurrentTaskFilesContext>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCurrentTaskFile(filePath: string) {
  return useContext(CurrentTaskFilesContext)?.get(filePath);
}

// Resolves an asset URL to the file's current on-disk version so previews of a
// past message follow later overwrites in place instead of pinning stale bytes.
// Falls back to the URL as built (e.g. the file was deleted) so the preview can
// degrade to its not-available state.
// eslint-disable-next-line react-refresh/only-export-components
export function useLiveAssetUrl(file: { filePath: string; url: string }) {
  const currentFile = useCurrentTaskFile(file.filePath);
  return currentFile
    ? withAssetUrlVersion(file.url, currentFile.modifiedAt)
    : file.url;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTaskFileReferenceStatus(file: {
  filePath: string;
  modifiedAt?: number;
}) {
  const files = useContext(CurrentTaskFilesContext);
  if (!files || isOutsideTaskDir(file.filePath)) {
    return;
  }

  const currentFile = files.get(file.filePath);
  if (!currentFile) {
    return "missing";
  }

  if (
    file.modifiedAt !== undefined &&
    currentFile.modifiedAt !== file.modifiedAt
  ) {
    return "stale";
  }

  return "current";
}

// The index walks the task directory, so it has nothing to say about a file
// reached by its mount path -- a shared folder's, above all. Answering
// "missing" for one is a claim the index cannot back, and it renders a file
// that is right there as a tombstone.
function isOutsideTaskDir(filePath: string) {
  return filePath.startsWith("/");
}
