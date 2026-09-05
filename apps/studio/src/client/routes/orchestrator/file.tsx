import { FileViewer } from "@/client/components/file-viewer";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { getAssetBaseUrl } from "@/client/lib/asset-base-url";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { rpcClient } from "@/client/rpc/client";
import { MOUNT } from "@instrument-org/workspace/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { LaptopIcon } from "@phosphor-icons/react/Laptop";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { z } from "zod";

/**
 * A file on its own screen, in the viewer the task page uses, with where it
 * lives on the Mac along the top: each part of the path opens that folder on
 * This Mac, so a file the conversation linked is one click from its folder.
 */
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
  const navigate = useNavigate();
  const state = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({ input: { id: taskId } }),
  );
  const filename = path.split("/").at(-1) ?? path;
  const place = hostPlace(path, state.data?.attachedFolders ?? {});

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border px-3 text-xs text-muted-foreground">
        <button
          className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-foreground/5 hover:text-foreground"
          onClick={() => {
            void navigate({
              search: { path: "", root: "~" },
              to: "/orchestrator/computer",
            });
          }}
          type="button"
        >
          <LaptopIcon className="size-3.5" />
          This Mac
        </button>
        {place?.crumbs.map((crumb) => (
          <span className="flex items-center gap-0.5" key={crumb.path}>
            <CaretRightIcon className="size-3" />
            <button
              className="rounded px-1 py-0.5 hover:bg-foreground/5 hover:text-foreground"
              onClick={() => {
                void navigate({
                  search: { path: "", root: crumb.path },
                  to: "/orchestrator/computer",
                });
              }}
              type="button"
            >
              {crumb.name}
            </button>
          </span>
        ))}
        <CaretRightIcon className="size-3" />
        <span className="truncate px-1 text-foreground">{filename}</span>
      </div>
      <div className="min-h-0 flex-1 p-3">
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
    </div>
  );
}

/**
 * Where a virtual path lives on the Mac: the granted folder its mount stands
 * for, then each folder below it, as crumbs that open on This Mac.
 */
function hostPlace(
  virtualPath: string,
  attachedFolders: Record<string, { mountName: string; path: string }>,
) {
  const prefix = `${MOUNT.attachedFolders}/`;
  if (!virtualPath.startsWith(prefix)) {
    return;
  }
  const [mountName, ...rest] = virtualPath.slice(prefix.length).split("/");
  const folder = Object.values(attachedFolders).find(
    (attached) => attached.mountName === mountName,
  );
  if (!folder) {
    return;
  }
  const crumbs = [
    {
      name: folder.path.split("/").findLast(Boolean) ?? mountName,
      path: folder.path,
    },
  ];
  let at = folder.path;
  for (const segment of rest.slice(0, -1)) {
    at = `${at}/${segment}`;
    crumbs.push({ name: segment, path: at });
  }
  return { crumbs };
}
