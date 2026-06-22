import { rpcClient } from "@/client/rpc/client";
import { type Task } from "@instrument-org/workspace/client";
import {
  CalendarIcon,
  ChatTextIcon,
  ClockIcon,
  FileTextIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";

export function TaskStatsCard({ task }: { task: Task }) {
  const { data: messageCount } = useQuery(
    rpcClient.workspace.message.count.queryOptions({
      input: { id: task.id },
    }),
  );

  const { data: files } = useQuery({
    ...rpcClient.workspace.task.files.list.queryOptions({
      input: { taskId: task.id },
    }),
  });
  const fileCount = files?.length;

  return (
    <div className="flex items-center gap-3 overflow-hidden rounded-lg border bg-muted/50 p-4">
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="truncate font-medium text-foreground">{task.title}</div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <CalendarIcon className="size-3" />
            <span>Created {format(task.createdAt, "MMM d, yyyy")}</span>
          </div>
          <div className="flex items-center gap-1">
            <ClockIcon className="size-3" />
            <span>
              Updated{" "}
              {formatDistanceToNow(task.updatedAt, { addSuffix: true })
                .replace("less than ", "")
                .replace("about ", "")}
            </span>
          </div>
          {messageCount !== undefined && messageCount > 0 && (
            <div className="flex items-center gap-1">
              <ChatTextIcon className="size-3" />
              <span>
                {messageCount} {messageCount === 1 ? "message" : "messages"}
              </span>
            </div>
          )}
          {fileCount !== undefined && fileCount > 0 && (
            <div className="flex items-center gap-1">
              <FileTextIcon className="size-3" />
              <span>
                {fileCount} {fileCount === 1 ? "file" : "files"}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
