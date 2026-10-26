import { DeleteWithProgressDialog } from "@/client/components/delete-with-progress-dialog";
import { toast } from "@/client/lib/toast";
import { osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { chatListOptions } from "./chat-list-query";
import { type Chat } from "./chats";

/** How many chats the dialog names before it counts the rest. */
const CHATS_NAMED = 5;

/** What the person chose for the chats' folders they were about to trash. */
export type ChatFolderChoice =
  /** The chats went, folders and all; the rest of the paths are still to trash. */
  | { kind: "chats"; rest: string[] }
  /** Every path goes as Files trashes anything, `kept` of them chats' folders whose chats stay. */
  | { kept: number; kind: "folders"; rest: string[] }
  | { kind: "stop" };

type Asking = {
  chats: { id: ChatId; path: string }[];
  paths: string[];
  settle: (choice: ChatFolderChoice) => void;
};

/**
 * Asks, before Files trashes a chat's own folder, whether the chat goes too.
 * A trashed folder alone leaves the chat in the list, and its next message
 * makes the folder again with only the transcript in it, so someone
 * trashing it almost always means the chat. Deleting it goes through the
 * chat's own delete, which stops its agents and takes its tasks and records
 * along; only the folder is trashed the way Files trashes anything, Undo
 * included.
 */
export function useChatFolderTrash() {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [open, setOpen] = useState(false);

  /** The choice for `paths`, or folders straight away when none is a chat's. */
  const ask = async (paths: string[]): Promise<ChatFolderChoice> => {
    // Files trashes the way it always did when the workspace cannot say.
    const chats = await rpcClient.workspace.chats.ofFolders
      .call({ paths })
      .catch(() => []);
    if (chats.length === 0) {
      return { kept: 0, kind: "folders", rest: paths };
    }
    return new Promise((settle) => {
      setAsking({ chats, paths, settle });
      setOpen(true);
    });
  };

  const dialog = asking ? (
    <ChatFolderDialog
      asking={asking}
      onExitComplete={() => {
        setAsking(null);
      }}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          asking.settle({ kind: "stop" });
        }
      }}
      open={open}
    />
  ) : null;
  return { ask, dialog };
}

function ChatFolderDialog({
  asking,
  onExitComplete,
  onOpenChange,
  open,
}: {
  asking: Asking;
  onExitComplete: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const queryClient = useQueryClient();
  const list = useQuery(chatListOptions());
  const titleOf = (id: ChatId) =>
    list.data?.find((chat) => chat.id === id)?.title ?? "Untitled chat";
  const one = asking.chats.length === 1;
  const named = asking.chats.slice(0, CHATS_NAMED);
  const more = asking.chats.length - named.length;
  const chatPaths = new Set(asking.chats.map((chat) => chat.path));
  const rest = asking.paths.filter((at) => !chatPaths.has(at));
  // Settled once: closing the dialog after a choice says stop, which the
  // promise ignores.
  const settle = asking.settle;

  return (
    <DeleteWithProgressDialog
      actionLabel={one ? "Delete chat" : `Delete ${asking.chats.length} chats`}
      alternative={{
        label: one ? "Only the folder" : "Only the folders",
        onSelect: () => {
          settle({
            kept: asking.chats.length,
            kind: "folders",
            rest: asking.paths,
          });
        },
      }}
      content={
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-lg border bg-muted/50 px-4 py-3 text-sm">
            <ul className="flex flex-col gap-0.5 text-foreground">
              {named.map((chat) => (
                <li className="truncate font-medium" key={chat.id}>
                  {titleOf(chat.id)}
                </li>
              ))}
              {more > 0 && (
                <li className="text-xs text-muted-foreground">
                  and {more} more
                </li>
              )}
            </ul>
            <div className="mt-1 text-xs text-muted-foreground">
              {one
                ? "Any tasks it started go too."
                : "Any tasks they started go too."}
            </div>
          </div>
          <div className="px-1 text-xs text-muted-foreground">
            Everything goes to your {osConventions().trash}, where you can
            restore it.
          </div>
        </div>
      }
      description={
        one
          ? "This is a chat’s folder. If you only delete the folder, the chat stays in your list and makes a new folder the next time you send it a message."
          : "These are chats’ folders. If you only delete the folders, the chats stay in your list and each makes a new folder the next time you send it a message."
      }
      items={asking.chats}
      onDelete={async (chats) => {
        const gone = new Set<ChatId>();
        try {
          for (const chat of chats) {
            await rpcClient.workspace.chats.trash.call({
              id: chat.id,
              itsFolder: true,
            });
            gone.add(chat.id);
          }
        } catch (error) {
          toast.error(
            one ? "Couldn't delete the chat" : "Couldn't delete every chat",
            {
              cause: error,
              description:
                "Close anything using its folders, like an editor, a terminal or a server, and try again.",
            },
          );
          throw error;
        } finally {
          if (gone.size > 0) {
            queryClient.setQueryData<Chat[]>(
              chatListOptions().queryKey,
              (rows) => rows?.filter((each) => !gone.has(each.id)),
            );
          }
        }
        settle({ kind: "chats", rest });
      }}
      onExitComplete={onExitComplete}
      onOpenChange={onOpenChange}
      open={open}
      title={one ? "Delete the chat too?" : "Delete these chats too?"}
    />
  );
}
