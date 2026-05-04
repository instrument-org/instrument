import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import { isFileCopyable, isFileDownloadable } from "@/client/lib/file-actions";
import { getFileType } from "@/client/lib/get-file-type";
import { rpcClient } from "@/client/rpc/client";
import { skipToken, useQuery } from "@tanstack/react-query";

export function useFileActionVisibility(file: ProjectFileViewerFile) {
  const isLatestVersion = useIsLatestVersion({
    filePath: file.filePath,
    projectSubdomain: file.projectSubdomain,
    versionRef: file.versionRef,
  });

  const fileType = getFileType(file);
  const isDownloadable = isFileDownloadable(file.url);
  const isCopyableByMime = isFileCopyable(file.mimeType, file.url);
  const isTextLike =
    fileType === "code" ||
    fileType === "text" ||
    fileType === "markdown" ||
    fileType === "html";

  return {
    showCopy: isCopyableByMime || (isTextLike && isDownloadable),
    showDownload: isDownloadable,
    showReveal: isLatestVersion,
  };
}

function useIsLatestVersion({
  filePath,
  projectSubdomain,
  versionRef,
}: {
  filePath: string;
  projectSubdomain: ProjectFileViewerFile["projectSubdomain"];
  versionRef?: string;
}) {
  const { data: versionRefs } = useQuery(
    rpcClient.workspace.project.git.fileVersionRefs.queryOptions({
      input: versionRef ? { filePath, projectSubdomain } : skipToken,
    }),
  );

  return (
    !versionRef ||
    !versionRefs ||
    versionRefs.length === 0 ||
    versionRefs.at(-1) === versionRef
  );
}
