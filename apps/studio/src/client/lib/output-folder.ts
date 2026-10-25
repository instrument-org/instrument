import { rpcClient } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
import { useQuery } from "@tanstack/react-query";

/**
 * Where the workspace is kept and where finished work goes, asked once: both
 * change only with a restart.
 */
export function storageLocationQueryOptions() {
  return rpcClient.workspace.storage.location.queryOptions({
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * The output folder, where a task's results go when nobody said where: the
 * person's Instrument folder once they picked one, `Instrument` in their
 * Documents until then (`outputFolderPath`). Undefined until the main
 * process answers.
 */
export function useOutputFolder(): string | undefined {
  return useQuery(storageLocationQueryOptions()).data?.outputFolder;
}

/**
 * The address a fresh Finder opens at: standing in the output folder, or in
 * the home folder before that is known.
 */
export function outputFolderHref(outputFolder: string | undefined): string {
  return folderHref(outputFolder ?? "~");
}

/**
 * The workspace's own folder, where its key folders and `.instrument` are.
 * Undefined until the main process answers.
 */
export function useWorkspaceFolder(): string | undefined {
  return useQuery(storageLocationQueryOptions()).data?.rootDir;
}
