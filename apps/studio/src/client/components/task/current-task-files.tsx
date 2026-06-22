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

// eslint-disable-next-line react-refresh/only-export-components
export function useTaskFileReferenceStatus({
  filePath,
  modifiedAt,
}: {
  filePath: string;
  modifiedAt: number | undefined;
}) {
  const files = useContext(CurrentTaskFilesContext);
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
