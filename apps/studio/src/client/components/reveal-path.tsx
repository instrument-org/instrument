import { displayPath } from "@/client/lib/path-utils";
import { hasFilesView, showInFolder } from "@/client/lib/show-in-files";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { FolderOpenIcon } from "@phosphor-icons/react/FolderOpen";
import { toast } from "sonner";

/**
 * A path read from the home folder's own name, that shows its folder: in Files
 * where the window has it, in the Finder elsewhere.
 *
 * Shortened because everything above the home folder is noise to the person
 * whose folder it is.
 */
export function RevealPath({
  allowWrap = false,
  className,
  hideIcon = false,
  path,
}: {
  allowWrap?: boolean;
  className?: string;
  hideIcon?: boolean;
  path: string;
}) {
  return (
    <button
      className={cn(
        "flex min-w-0 gap-2 text-xs text-muted-foreground hover:text-foreground",
        allowWrap ? "items-start" : "items-center",
        className,
      )}
      onClick={async () => {
        if (hasFilesView()) {
          await showInFolder(path, { kind: "folder" });
          return;
        }
        const [error] = await safe(
          rpcClient.utils.showFileInFolder.call({ filepath: path }),
        );
        if (error) {
          toast.error("That folder is no longer on disk.");
        }
      }}
      type="button"
    >
      {hideIcon ? null : <FolderOpenIcon className="size-4 shrink-0" />}
      <span
        className={cn(
          "font-mono",
          allowWrap ? "text-left break-all whitespace-normal" : "truncate",
        )}
      >
        {displayPath(path)}
      </span>
    </button>
  );
}
