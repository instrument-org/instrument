import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useOpenTaskFile } from "@/client/hooks/use-open-task-file";
import { isMacOS } from "@/client/lib/utils";

import {
  useTaskFileOpenCandidates,
  useTaskFileOpenTarget,
} from "./use-task-file-open-target";

export type TaskFileOpenControl = ReturnType<typeof useTaskFileOpenControl>;

type FileRef = Pick<TaskFileViewerFile, "filePath" | "taskId">;

export function useTaskFileOpenControl(
  file: FileRef | undefined,
  { loadCandidates = true }: { loadCandidates?: boolean } = {},
) {
  const openTaskFile = useOpenTaskFile();
  const target = useTaskFileOpenTarget(file);
  const {
    apps,
    isError: didCandidatesFail,
    isPending: areCandidatesPending,
  } = useTaskFileOpenCandidates(file, {
    enabled: file != null && loadCandidates && isMacOS(),
  });
  // Keep the trigger on a failed lookup: hiding it is indistinguishable from
  // "this file type has one app", and leaves no way to retry.
  const showOpenWithDropdown =
    target.showOpen &&
    (areCandidatesPending || didCandidatesFail || apps.length > 1);

  return {
    ...target,
    open: () => {
      if (file) {
        openTaskFile(file);
      }
    },
    showOpenWithDropdown,
  };
}
