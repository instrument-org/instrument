import { ShowInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { useTranscriptActions } from "@/client/components/task/transcript-actions";
import { showInFolderLabel, showTaskFolder } from "@/client/lib/show-in-files";
import { rpcClient } from "@/client/rpc/client";
import { ArchiveIcon } from "@phosphor-icons/react/Archive";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { ArrowLineDownIcon } from "@phosphor-icons/react/ArrowLineDown";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/EnvelopeSimple";
import { EnvelopeSimpleOpenIcon } from "@phosphor-icons/react/EnvelopeSimpleOpen";
import { StarIcon } from "@phosphor-icons/react/Star";
import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

import { chatListOptions } from "./chat-list-query";
import { type Chat } from "./chats";
import { type RowAction } from "./row-shell";

/** Which chat a call is about, as every chat mutation takes it. */
interface ChatInput {
  sessionId: string;
}

/**
 * A chat's actions as every menu of one lists them, each group set off by a
 * separator: its marks first, then what it keeps on disk, then putting it
 * away. A menu adds its own entries between these, never reorders them.
 */
export function chatMenuGroups(actions: RowAction[]) {
  const of = (ids: string[]) =>
    actions.filter((action) => ids.includes(action.id));
  return {
    files: of(["transcript", "reveal"]),
    marks: of(["read", "unread", "star", "unstar"]),
    put: of(["archive", "unarchive"]),
  };
}

/** The actions of one chat, where one chat is all there is: the head of its pane. */
export function useChatActions(chat: Chat): RowAction[] {
  return useChatActionsFor()(chat);
}

/**
 * What a chat offers that no line of it carries, in the order the row's
 * edge and its menu list them: putting it away, or back in the inbox, with
 * an undo in the toast either way; marking it read while something in it
 * is unseen, or unread again once it has replies to be unread, with no
 * toast at all, since the row itself says which it is; starring it or
 * taking the star back, last, where a starred row wears its star; and, in
 * the menu alone, saving its transcript and showing its folder.
 *
 * Answered for any chat by one set of mutations, so a list asks once and
 * hands each row its actions, rather than every row registering its own ten
 * observers on the mutation cache and re-rendering on every other row's
 * archive. Everything that depends on the chat happens in the call.
 */
export function useChatActionsFor(): (chat: Chat) => RowAction[] {
  const transcript = useTranscriptActions({ sessionId: undefined });
  const queryClient = useQueryClient();
  const paint = (sessionId: string, change: (chat: Chat) => Chat) => {
    paintChat(queryClient, { sessionId }, change);
  };
  const repaint = () => {
    repaintChats(queryClient);
  };
  // The rest are each held as their stable `mutate` rather than as the
  // mutation object, which is new on every render and would make the
  // function returned below new with it, and every row the list memoizes on
  // it render again.
  const { mutate: seen } = useMutation(
    rpcClient.workspace.chats.seen.mutationOptions({
      onError: repaint,
      onMutate: (input) => {
        paint(input.sessionId, (chat) => ({ ...chat, unread: 0 }));
      },
    }),
  );
  // Unseen again is the newest reply only, which is one to the count.
  const { mutate: unseen } = useMutation(
    rpcClient.workspace.chats.unseen.mutationOptions({
      onError: repaint,
      onMutate: (input) => {
        paint(input.sessionId, (chat) => ({
          ...chat,
          unread: Math.max(chat.unread, 1),
        }));
      },
    }),
  );
  const { mutate: star } = useMutation(
    rpcClient.workspace.chats.star.mutationOptions({
      onError: repaint,
      onMutate: (input) => {
        paint(input.sessionId, (chat) => ({
          ...chat,
          starred: input.starred,
        }));
      },
    }),
  );
  return (chat) => {
    const input = { sessionId: chat.id };
    const put: RowAction = chat.archived
      ? {
          icon: <ArrowCounterClockwiseIcon className="size-3.5" />,
          id: "unarchive",
          label: "Unarchive",
          run: () => {
            setArchived(queryClient, input, false);
          },
        }
      : {
          icon: <ArchiveIcon className="size-3.5" />,
          id: "archive",
          label: "Archive",
          run: () => {
            setArchived(queryClient, input, true);
          },
        };
    const mark: RowAction[] =
      chat.unread > 0
        ? [
            {
              icon: <EnvelopeSimpleOpenIcon className="size-3.5" />,
              id: "read",
              label: "Mark as read",
              run: () => {
                seen(input);
              },
            },
          ]
        : chat.replyCount > 0
          ? [
              {
                icon: <EnvelopeSimpleIcon className="size-3.5" />,
                id: "unread",
                label: "Mark as unread",
                run: () => {
                  unseen(input);
                },
              },
            ]
          : [];
    const starred: RowAction = chat.starred
      ? {
          icon: <StarIcon className="size-3.5" weight="fill" />,
          id: "unstar",
          label: "Unstar",
          run: () => {
            star({ ...input, starred: false });
          },
        }
      : {
          icon: <StarIcon className="size-3.5" />,
          id: "star",
          label: "Star",
          run: () => {
            star({ ...input, starred: true });
          },
        };
    // Saves without opening anything: the transcript lands in Downloads,
    // named for the chat, and its path on the clipboard.
    const save: RowAction = {
      icon: <ArrowLineDownIcon className="size-3.5" />,
      id: "transcript",
      label: "Save transcript",
      menuOnly: true,
      run: () => {
        transcript.save("markdown", {
          id: chat.taskId,
          label: chat.title,
          sessionId: chat.id,
        });
      },
    };
    const show: RowAction = {
      icon: <ShowInFolderIcon className="size-4" kind="folder" />,
      id: "reveal",
      label: showInFolderLabel("folder"),
      menuOnly: true,
      run: () => {
        void showTaskFolder(chat.taskId);
      },
    };
    return [put, ...mark, starred, save, show];
  };
}

/**
 * Paints a mark onto one chat in the list from the click rather than from
 * the round trip: the row moves, or its mark changes, the moment it is asked
 * for. The live list's next answer is the truth either way.
 */
function paintChat(
  queryClient: QueryClient,
  { sessionId }: ChatInput,
  change: (chat: Chat) => Chat,
) {
  queryClient.setQueryData<Chat[]>(chatListOptions().queryKey, (chats) =>
    chats?.map((chat) => (chat.id === sessionId ? change(chat) : chat)),
  );
}

/** Asks for the list's truth again at once, after a paint the workspace refused. */
function repaintChats(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    queryKey: chatListOptions().queryKey,
  });
}

/**
 * Puts a chat away or brings it back. Each way's toast offers the other
 * way back, so an undo can be undone; the toast hangs off the call's answer
 * rather than off a row, since the row is gone from the list by the time it
 * lands. Outside the hook so that it is one function for the window's life,
 * which the actions handed to every row are memoized on.
 */
function setArchived(
  queryClient: QueryClient,
  input: ChatInput,
  archived: boolean,
) {
  paintChat(queryClient, input, (chat) => ({ ...chat, archived }));
  const call = archived
    ? rpcClient.workspace.chats.archive.call(input)
    : rpcClient.workspace.chats.unarchive.call(input);
  call.then(
    () => {
      toast(archived ? "Archived" : "Moved to Inbox", {
        action: {
          label: "Undo",
          onClick: () => {
            setArchived(queryClient, input, !archived);
          },
        },
      });
    },
    (error: unknown) => {
      repaintChats(queryClient);
      toast.error(
        archived
          ? "Failed to archive the chat"
          : "Failed to move the chat to the inbox",
        { description: error instanceof Error ? error.message : String(error) },
      );
    },
  );
}
