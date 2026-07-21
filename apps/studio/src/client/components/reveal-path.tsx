import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { FolderOpenIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

const HOME_PREFIX = /^\/Users\/[^/]+/;

/**
 * A path with the home directory collapsed, that reveals itself in Finder.
 *
 * Paths are shown shortened because the full one is mostly noise, and the
 * username in it is the user's own name — fine on screen, needless in a
 * screenshot or a shared recording.
 */
export function RevealPath({
  className,
  path,
}: {
  className?: string;
  path: string;
}) {
  return (
    <button
      className={cn(
        "flex min-w-0 items-center gap-2 text-xs text-muted-foreground hover:text-foreground",
        className,
      )}
      onClick={async () => {
        const [error] = await safe(
          rpcClient.utils.showFileInFolder.call({ filepath: path }),
        );
        if (error) {
          toast.error("That folder is no longer on disk.");
        }
      }}
      title={path}
      type="button"
    >
      <FolderOpenIcon className="size-4 shrink-0" />
      <span className="truncate font-mono">
        {path.replace(HOME_PREFIX, "~")}
      </span>
    </button>
  );
}
