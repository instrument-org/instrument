import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { FolderOpenIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

// Collapse the user's home directory to ~ across platforms, so the username in
// it never renders verbatim off-mac: macOS (/Users/<name>), Linux (/home/<name>),
// and Windows (C:\Users\<name>).
const HOME_PREFIX =
  /^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:[/\\]Users[/\\][^/\\]+)/;

/**
 * A path with the home directory collapsed, that reveals itself in Finder.
 *
 * Paths are shown shortened because the full one is mostly noise, and the
 * username in it is the user's own name — fine on screen, needless in a
 * screenshot or a shared recording.
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
        {path.replace(HOME_PREFIX, "~")}
      </span>
    </button>
  );
}
