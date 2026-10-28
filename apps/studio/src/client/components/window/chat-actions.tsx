import { openReportDialog } from "@/client/atoms/report-dialog";
import { ShowInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { useCopyChatLocation } from "@/client/components/task/copy-chat-location";
import { useTabDeveloperMode } from "@/client/hooks/use-developer-mode";
import { feedbackReport } from "@/client/lib/problem-reports";
import { showInFolderLabel, showChatFolder } from "@/client/lib/show-in-files";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { ArchiveIcon } from "@phosphor-icons/react/Archive";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { ChatTextIcon } from "@phosphor-icons/react/ChatText";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { NotificationIcon } from "@phosphor-icons/react/Notification";
import { StarIcon } from "@phosphor-icons/react/Star";
import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "@/client/lib/toast";

import { chatListOptions } from "./chat-list-query";
import { type Chat } from "./chats";
import { type RowAction } from "./row-shell";

/** Which chat a call is about, as every chat mutation takes it. */
interface ChatInput {
  id: ChatId;
}

/**
 * A chat's actions as every menu of one lists them, each group set off by a
 * separator: its marks first, then what it keeps on disk, then sending
 * feedback about it, then putting it away. A menu adds its own entries
 * between these, never reorders them.
 */
export function chatMenuGroups(actions: RowAction[]) {
  const of = (ids: string[]) =>
    actions.filter((action) => ids.includes(action.id));
  return {
    feedback: of(["feedback"]),
    files: of(["location", "reveal"]),
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
 * an undo in the toast either way; marking it read while it carries the
 * unread mark, or unread while it does not, whatever it holds, with no
 * toast at all, since the row itself says which it is; starring it or
 * taking the star back, last, where a starred row wears its star; and, in
 * the menu alone, showing its folder, in developer mode copying where its
 * records are, and sending feedback about it.
 *
 * Answered for any chat by one set of mutations, so a list asks once and
 * hands each row its actions, rather than every row registering its own ten
 * observers on the mutation cache and re-rendering on every other row's
 * archive. Everything that depends on the chat happens in the call.
 */
export function useChatActionsFor(): (chat: Chat) => RowAction[] {
  const copyChatLocation = useCopyChatLocation();
  const isDeveloperMode = useTabDeveloperMode();
  const queryClient = useQueryClient();
  const paint = (id: ChatId, change: (chat: Chat) => Chat) => {
    paintChat(queryClient, { id }, change);
  };
  const repaint = () => {
    repaintChats(queryClient);
  };
  // The rest are each held as their stable `mutate` rather than as the
  // mutation object, which is new on every render and would make the
  // function returned below new with it, and every row the list memoizes on
  // it render again.
  const { mutate: read } = useMutation(
    rpcClient.workspace.chats.read.mutationOptions({
      onError: repaint,
      onMutate: (input) => {
        paint(input.id, (chat) => ({
          ...chat,
          unread: false,
          unreadByUser: false,
        }));
      },
    }),
  );
  const { mutate: unread } = useMutation(
    rpcClient.workspace.chats.unread.mutationOptions({
      onError: repaint,
      onMutate: (input) => {
        paint(input.id, (chat) => ({
          ...chat,
          unread: true,
          unreadByUser: true,
        }));
      },
    }),
  );
  const { mutate: star } = useMutation(
    rpcClient.workspace.chats.star.mutationOptions({
      onError: repaint,
      onMutate: (input) => {
        paint(input.id, (chat) => ({
          ...chat,
          starred: input.starred,
        }));
      },
    }),
  );
  return (chat) => {
    const input = { id: chat.id };
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
    const mark: RowAction = chat.unread
      ? {
          // The unread view's mark, lit while the chat is unread, the way
          // the star is lit while it is starred.
          icon: <NotificationIcon className="size-3.5" weight="fill" />,
          id: "read",
          label: "Mark as read",
          run: () => {
            read(input);
          },
        }
      : {
          icon: <NotificationIcon className="size-3.5" />,
          id: "unread",
          label: "Mark as unread",
          run: () => {
            unread(input);
          },
        };
    const starred: RowAction = chat.starred
      ? {
          // In the star's amber, as the starred row's own star is.
          icon: (
            <StarIcon className="size-3.5 text-warning-500" weight="fill" />
          ),
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
    const location: RowAction = {
      developerMode: true,
      icon: <CopyIcon className="size-3.5" />,
      id: "location",
      label: "Copy chat location",
      menuOnly: true,
      run: () => {
        copyChatLocation({ id: chat.id, sessionId: chat.sessionId });
      },
    };
    const show: RowAction = {
      icon: <ShowInFolderIcon className="size-4" kind="folder" />,
      id: "reveal",
      label: showInFolderLabel("folder"),
      menuOnly: true,
      run: () => {
        void showChatFolder(chat.id);
      },
    };
    const feedback: RowAction = {
      icon: <ChatTextIcon className="size-3.5" />,
      id: "feedback",
      label: "Send feedback…",
      menuOnly: true,
      run: () => {
        openReportDialog(
          feedbackReport({ chatId: chat.id, surface: "chat-menu" }),
        );
      },
    };
    return [
      put,
      mark,
      starred,
      ...(isDeveloperMode ? [location] : []),
      show,
      feedback,
    ];
  };
}

/**
 * Paints a mark onto one chat in the list from the click rather than from
 * the round trip: the row moves, or its mark changes, the moment it is asked
 * for. The live list's next answer is the truth either way.
 */
function paintChat(
  queryClient: QueryClient,
  { id }: { id: ChatId },
  change: (chat: Chat) => Chat,
) {
  queryClient.setQueryData<Chat[]>(chatListOptions().queryKey, (chats) =>
    chats?.map((chat) => (chat.id === id ? change(chat) : chat)),
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
          ? "Couldn't archive the chat"
          : "Couldn't move the chat to the inbox",
        { cause: error },
      );
    },
  );
}
