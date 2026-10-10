import { DeleteWithProgressDialog } from "@/client/components/delete-with-progress-dialog";
import { getTrashTerminology } from "@/client/lib/trash-terminology";
import { rpcClient } from "@/client/rpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/client/lib/toast";

import { chatListOptions } from "./chat-list-query";
import { type Chat } from "./chats";
import { childTasksOptions } from "./child-tasks-query";

/** How many of the chat's tasks the dialog names before it counts the rest. */
const TASKS_NAMED = 5;

/**
 * Asks before a chat goes to the trash with every task it started, and says
 * which: the conversation, each task by its title, and everything in their
 * folders. What its tasks saved into the user's own folders is not in the
 * chat's folder and stays where it is, which the dialog says too, since it is
 * the thing most worth knowing before pressing the button.
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
  const trashTerminology = getTrashTerminology();
  const children = useQuery({
    ...childTasksOptions(chat.id),
    enabled: open,
  });
  const tasks = children.data ?? [];
  const named = tasks.slice(0, TASKS_NAMED);
  const more = tasks.length - named.length;

  return (
    <DeleteWithProgressDialog
      content={
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
      }
      description={`This chat, the tasks it started, and everything in their folders move to your ${trashTerminology}, where you can restore them. Files they saved to your own folders, like Documents/Instrument, stay where they are.`}
      items={[chat]}
      onDelete={async () => {
        try {
          await rpcClient.workspace.chats.trash.call({ id: chat.id });
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
      onOpenChange={onOpenChange}
      open={open}
      title="Delete this chat?"
    />
  );
}
