import { type RPCOutput } from "@/client/rpc/client";
import { createContext, type ReactNode, useContext } from "react";

type ProjectFile = RPCOutput["workspace"]["project"]["files"]["list"][number];

const CurrentProjectFilesContext = createContext<
  ReadonlyMap<string, ProjectFile> | undefined
>(undefined);

export function CurrentProjectFilesProvider({
  children,
  files,
}: {
  children: ReactNode;
  files: ProjectFile[] | undefined;
}) {
  const filesByPath = files
    ? new Map(files.map((file) => [file.filePath, file]))
    : undefined;

  return (
    <CurrentProjectFilesContext value={filesByPath}>
      {children}
    </CurrentProjectFilesContext>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCurrentProjectFile(filePath: string) {
  return useContext(CurrentProjectFilesContext)?.get(filePath);
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProjectFileReferenceStatus({
  filePath,
  modifiedAt,
}: {
  filePath: string;
  modifiedAt: number | undefined;
}) {
  const files = useContext(CurrentProjectFilesContext);
  if (!files || modifiedAt === undefined) {
    return;
  }
  const currentFile = files.get(filePath);
  if (!currentFile) {
    return "missing" as const;
  }
  return currentFile.modifiedAt === modifiedAt
    ? ("current" as const)
    : ("stale" as const);
}
