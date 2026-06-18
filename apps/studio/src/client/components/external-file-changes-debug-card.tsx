import { cn } from "@/client/lib/utils";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";

import { DeveloperModeBadge } from "./tool-part/developer-mode-badge";

const STATUS_COLOR: Record<
  SessionMessageDataPart.FileChangeDataPartItem["status"],
  string
> = {
  added: "text-green-600 dark:text-green-400",
  deleted: "text-red-600 dark:text-red-400",
  modified: "text-yellow-600 dark:text-yellow-400",
};

// Developer-mode-only peek at the external file changes the agent was told
// about for this message. Intentionally minimal; not user-facing.
export function ExternalFileChangesDebugCard({
  className,
  files,
}: {
  className?: string;
  files: SessionMessageDataPart.FileChangeDataPartItem[];
}) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-border bg-muted/30 p-2",
        className,
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <DeveloperModeBadge />
        <span className="text-[10px] leading-tight text-muted-foreground">
          External file changes the agent was told about for this message.
        </span>
      </div>
      <ul className="flex flex-col gap-y-0.5 font-mono text-xs">
        {files.map((file) => (
          <li className="flex items-center gap-x-2" key={file.filePath}>
            <span className={cn("w-16 shrink-0", STATUS_COLOR[file.status])}>
              {file.status}
            </span>
            <span className="truncate text-muted-foreground">
              {file.filePath}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
