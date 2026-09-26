import { useTranscriptActions } from "@/client/components/task/transcript-actions";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
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

import { useOrchestrator } from "./context";
import { type RowAction } from "./row-shell";
import { threadListOptions } from "./thread-list-query";
import { type Thread } from "./threads";

/** Which thread a call is about, as every thread mutation takes it. */
interface ThreadInput {
  id: TaskId;
  sessionId: string;
}

/** The actions of one thread, where one thread is all there is: the head of its pane. */
export function useThreadActions(thread: Thread): RowAction[] {
  return useThreadActionsFor()(thread);
}

/**
 * What a thread offers that no line of it carries, in the order the row's
 * edge and its menu list them: putting it away, or back in the inbox, with
 * an undo in the toast either way; marking it read while something in it
 * is unseen, or unread again once it has replies to be unread, with no
 * toast at all, since the row itself says which it is; and, in the menu
 * alone, starring it and saving its transcript.
 *
 * Answered for any thread by one set of mutations, so a list asks once and
 * hands each row its actions, rather than every row registering its own ten
 * observers on the mutation cache and re-rendering on every other row's
 * archive. Everything that depends on the thread happens in the call.
 */
export function useThreadActionsFor(): (thread: Thread) => RowAction[] {
  const { taskId } = useOrchestrator();
  const transcript = useTranscriptActions({ id: taskId, sessionId: undefined });
  const queryClient = useQueryClient();
  const paint = (sessionId: string, change: (thread: Thread) => Thread) => {
    paintThread(queryClient, { id: taskId, sessionId }, change);
  };
  const repaint = () => {
    repaintThreads(queryClient, taskId);
  };
  // The rest are each held as their stable `mutate` rather than as the
  // mutation object, which is new on every render and would make the
  // function returned below new with it, and every row the list memoizes on
  // it render again.
  const { mutate: seen } = useMutation(
    rpcClient.workspace.orchestrator.threads.seen.mutationOptions({
      onError: repaint,
      onMutate: (input) => {
        paint(input.sessionId, (thread) => ({ ...thread, unread: 0 }));
      },
    }),
  );
  // Unseen again is the newest reply only, which is one to the count.
  const { mutate: unseen } = useMutation(
    rpcClient.workspace.orchestrator.threads.unseen.mutationOptions({
      onError: repaint,
      onMutate: (input) => {
        paint(input.sessionId, (thread) => ({
          ...thread,
          unread: Math.max(thread.unread, 1),
        }));
      },
    }),
  );
  const { mutate: star } = useMutation(
    rpcClient.workspace.orchestrator.threads.star.mutationOptions({
      onError: repaint,
      onMutate: (input) => {
        paint(input.sessionId, (thread) => ({
          ...thread,
          starred: input.starred,
        }));
      },
    }),
  );
  return (thread) => {
    const input = { id: taskId, sessionId: thread.id };
    const put: RowAction = thread.archived
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
      thread.unread > 0
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
        : thread.replyCount > 0
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
    const starred: RowAction = thread.starred
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
    // named for the thread, and its path on the clipboard.
    const save: RowAction = {
      icon: <ArrowLineDownIcon className="size-3.5" />,
      id: "transcript",
      label: "Save transcript",
      menuOnly: true,
      run: () => {
        transcript.save("markdown", {
          label: thread.title,
          sessionId: thread.id,
        });
      },
    };
    return [put, ...mark, { ...starred, menuOnly: true }, save];
  };
}

/**
 * Paints a mark onto one thread in the list from the click rather than from
 * the round trip: the row moves, or its mark changes, the moment it is asked
 * for. The live list's next answer is the truth either way.
 */
function paintThread(
  queryClient: QueryClient,
  { id, sessionId }: ThreadInput,
  change: (thread: Thread) => Thread,
) {
  queryClient.setQueryData<Thread[]>(
    threadListOptions(id).queryKey,
    (threads) =>
      threads?.map((thread) =>
        thread.id === sessionId ? change(thread) : thread,
      ),
  );
}

/** Asks for the list's truth again at once, after a paint the workspace refused. */
function repaintThreads(queryClient: QueryClient, taskId: TaskId) {
  void queryClient.invalidateQueries({
    queryKey: threadListOptions(taskId).queryKey,
  });
}

/**
 * Puts a thread away or brings it back. Each way's toast offers the other
 * way back, so an undo can be undone; the toast hangs off the call's answer
 * rather than off a row, since the row is gone from the list by the time it
 * lands. Outside the hook so that it is one function for the window's life,
 * which the actions handed to every row are memoized on.
 */
function setArchived(
  queryClient: QueryClient,
  input: ThreadInput,
  archived: boolean,
) {
  paintThread(queryClient, input, (thread) => ({ ...thread, archived }));
  const call = archived
    ? rpcClient.workspace.orchestrator.threads.archive.call(input)
    : rpcClient.workspace.orchestrator.threads.unarchive.call(input);
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
      repaintThreads(queryClient, input.id);
      toast.error(
        archived
          ? "Failed to archive the chat"
          : "Failed to move the chat to the inbox",
        { description: error instanceof Error ? error.message : String(error) },
      );
    },
  );
}
