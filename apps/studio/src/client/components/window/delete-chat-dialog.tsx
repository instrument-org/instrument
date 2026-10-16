import { DeleteWithProgressDialog } from "@/client/components/delete-with-progress-dialog";
import { Checkbox } from "@/client/components/ui/checkbox";
import { osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "@/client/lib/toast";

import { chatListOptions } from "./chat-list-query";
import { type Chat } from "./chats";
import { childTasksOptions } from "./child-tasks-query";

/** How many of the chat's tasks the dialog names before it counts the rest. */
const TASKS_NAMED = 5;

/**
 * Asks before a chat goes to the trash with every task it started, and says
 * which: the conversation and each task by its title. What its tasks saved
 * into the user's own folders stays where it is, which the dialog says too,
 * since it is the thing most worth knowing before pressing the button.
 *
 * The chat's own folder under `Chats/` is offered rather than taken: the
 * transcript and what the agent finished are in there, and deleting a chat
 * to tidy a list is not a request to throw that away. So the box starts
 * clear, and the folder goes only for someone who asked.
 */
export function DeleteChatDialog({
  chat,
  onDeleted,
  onOpenChange,
  open,
}: {
  chat: Chat;
  /** Told once the chat is in the trash, so the window can put it away. */
  onDeleted: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const queryClient = useQueryClient();
  const trashTerminology = osConventions().trash;
  const children = useQuery({
    ...childTasksOptions(chat.id),
    enabled: open,
  });
  const tasks = children.data ?? [];
  const named = tasks.slice(0, TASKS_NAMED);
  const more = tasks.length - named.length;
  const [itsFolder, setItsFolder] = useState(false);
  const folderOption = useId();

  return (
    <DeleteWithProgressDialog
      content={
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-lg border bg-muted/50 px-4 py-3 text-sm">
            <div className="truncate font-medium text-foreground">
              {chat.title}
            </div>
            {tasks.length === 0 ? (
              <div className="mt-1 text-xs text-muted-foreground">
                No tasks were started in this chat.
              </div>
            ) : (
              <>
                <div className="mt-1 text-xs text-muted-foreground">
                  {tasks.length === 1
                    ? "The task it started goes too:"
                    : `The ${tasks.length} tasks it started go too:`}
                </div>
                <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-foreground">
                  {named.map((task) => (
                    <li className="truncate" key={task.id}>
                      {task.title}
                    </li>
                  ))}
                  {more > 0 && (
                    <li className="text-muted-foreground">and {more} more</li>
                  )}
                </ul>
              </>
            )}
          </div>
          <label className="flex cursor-default items-start gap-3 px-1">
            <Checkbox
              aria-describedby={`${folderOption}-detail`}
              aria-labelledby={`${folderOption}-label`}
              checked={itsFolder}
              className="mt-0.5"
              onCheckedChange={(value) => {
                setItsFolder(value === true);
              }}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm" id={`${folderOption}-label`}>
                Delete its folder too
              </span>
              <span
                className="text-xs text-muted-foreground"
                id={`${folderOption}-detail`}
              >
                The transcript and anything the agent made for you are in there.
              </span>
            </span>
          </label>
        </div>
      }
      description={`This chat and the tasks it started move to your ${trashTerminology}, where you can restore them. Files they saved to your own folders stay where they are.`}
      items={[chat]}
      onDelete={async () => {
        try {
          await rpcClient.workspace.chats.trash.call({
            id: chat.id,
            itsFolder,
          });
        } catch (error) {
          toast.error("Couldn't delete the chat", {
            cause: error,
            description:
              "Close anything using its folders, like an editor, a terminal or a server, and try again.",
          });
          throw error;
        }
        queryClient.setQueryData<Chat[]>(chatListOptions().queryKey, (chats) =>
          chats?.filter((each) => each.id !== chat.id),
        );
        queryClient.removeQueries({
          queryKey: rpcClient.workspace.chats.session.queryKey({
            input: { id: chat.id },
          }),
        });
        onDeleted();
      }}
      onOpenChange={(next) => {
        // Asked again each time, so the folder is never taken by a box the
        // person ticked for another chat.
        if (!next) {
          setItsFolder(false);
        }
        onOpenChange(next);
      }}
      open={open}
      title="Delete this chat?"
    />
  );
}
