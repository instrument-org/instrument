import { FileViewer } from "@/client/components/file-viewer";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { getAssetBaseUrl } from "@/client/lib/asset-base-url";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";

/** A file on its own screen, in the viewer the task page uses. */
export const Route = createFileRoute("/orchestrator/file")({
  component: FileRoute,
  validateSearch: z.object({
    /** The virtual path, which is how the conversation names a file. */
    path: z.string(),
  }),
});

function FileRoute() {
  const { taskId } = useOrchestrator();
  const { path } = Route.useSearch();
  const router = useRouter();
  const filename = path.split("/").at(-1) ?? path;
  return (
    <div className="h-full min-h-0 p-3">
      <FileViewer
        className="h-full"
        file={{
          filename,
          filePath: path,
          taskId,
          url: getAssetUrl({
            assetBase: getAssetBaseUrl(taskId),
            filePath: path,
          }),
        }}
        key={path}
        onClose={() => {
          router.history.back();
        }}
      />
    </div>
  );
}
