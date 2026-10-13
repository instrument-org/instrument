import { APP_PROTOCOL } from "@instrument-org/shared";
import { safe } from "@orpc/client";
import { toast } from "@/client/lib/toast";

import { type ViewerFile } from "../atoms/task-file-viewer";
import { rpcClient } from "../rpc/client";
import { downloadTaskFile } from "./download-task-file";

export async function copyFileToClipboard({
  hostPath,
  isImage,
}: {
  hostPath: string;
  isImage: boolean;
}) {
  const [error] = await safe(
    rpcClient.utils.copyFileToClipboard.call({
      filePath: hostPath,
      isImage,
    }),
  );
  if (error) {
    toast.error("Couldn't copy the file", { cause: error });
    throw error;
  }
}

export async function downloadFile(file: ViewerFile) {
  try {
    const response = await fetch(file.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }
    const blob = await response.blob();
    downloadTaskFile({
      ...file,
      blob,
    });
  } catch (error) {
    toast.error("Couldn't save the file", { cause: error });
    throw error;
  }
}

export function isFileDownloadable(url: string) {
  if (!url.trim()) {
    return false;
  }

  if (url.startsWith("data:")) {
    return true;
  }

  try {
    const urlObj = new URL(url);
    return (
      urlObj.protocol === `${APP_PROTOCOL}:` ||
      urlObj.hostname === "localhost" ||
      urlObj.hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}
