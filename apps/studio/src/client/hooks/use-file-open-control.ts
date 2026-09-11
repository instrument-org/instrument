import { type ViewerFile } from "@/client/atoms/task-file-viewer";
import { useOpenFile } from "@/client/hooks/use-open-file";
import { isMacOS } from "@/client/lib/utils";

import {
  useFileOpenCandidates,
  useFileOpenTarget,
} from "./use-file-open-target";

export type FileOpenControl = ReturnType<typeof useFileOpenControl>;

type FileRef = Pick<ViewerFile, "hostPath">;

export function useFileOpenControl(
  file: FileRef | undefined,
  { loadCandidates = true }: { loadCandidates?: boolean } = {},
) {
  const openFile = useOpenFile();
  const target = useFileOpenTarget(file);
  const {
    apps,
    isError: didCandidatesFail,
    isPending: areCandidatesPending,
  } = useFileOpenCandidates(file, {
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
        openFile(file);
      }
    },
    showOpenWithDropdown,
  };
}
