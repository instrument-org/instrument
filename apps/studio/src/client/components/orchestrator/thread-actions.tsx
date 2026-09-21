import { useTranscriptActions } from "@/client/components/task/transcript-actions";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { ArchiveIcon } from "@phosphor-icons/react/Archive";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { ArrowLineDownIcon } from "@phosphor-icons/react/ArrowLineDown";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/EnvelopeSimple";
import { EnvelopeSimpleOpenIcon } from "@phosphor-icons/react/EnvelopeSimpleOpen";
import { MagicWandIcon } from "@phosphor-icons/react/MagicWand";
import { StarIcon } from "@phosphor-icons/react/Star";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { useOrchestrator } from "./context";
import { type RowAction } from "./row-shell";
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
 * alone, starring it, naming it again from where its conversation stands
 * (the same call that names it after each finished turn), and saving its
 * transcript.
 *
 * Answered for any thread by one set of mutations, so a list asks once and
 * hands each row its actions, rather than every row registering its own ten
 * observers on the mutation cache and re-rendering on every other row's
 * archive. Everything that depends on the thread happens in the call.
 */
export function useThreadActionsFor(): (thread: Thread) => RowAction[] {
  const { taskId } = useOrchestrator();
  const retitle = useMutation(
    rpcClient.workspace.orchestrator.threads.retitle.mutationOptions({
      onError: (error) => {
        toast.error("Failed to rename the thread", {
          description: error.message,
        });
      },
    }),
  );
  const transcript = useTranscriptActions({ id: taskId, sessionId: undefined });
  // Each way's toast offers the other way back, so an undo can be undone.
  // The toasts hang off the mutations rather than off the calls, since the
  // row is gone from the list by the time either lands, and read the thread
  // off what was sent.
  const archive = useMutation(
    rpcClient.workspace.orchestrator.threads.archive.mutationOptions({
      onError: (error) => {
        toast.error("Failed to archive the thread", {
          description: error.message,
        });
      },
      onSuccess: (_result, input) => {
        toast("Archived", {
          action: {
            label: "Undo",
            onClick: () => {
              bringBack(input);
            },
          },
        });
      },
    }),
  );
  const unarchive = useMutation(
    rpcClient.workspace.orchestrator.threads.unarchive.mutationOptions({
      onError: (error) => {
        toast.error("Failed to move the thread to the inbox", {
          description: error.message,
        });
      },
      onSuccess: (_result, input) => {
        toast("Moved to Inbox", {
          action: {
            label: "Undo",
            onClick: () => {
              putAway(input);
            },
          },
        });
      },
    }),
  );
  const seen = useMutation(
    rpcClient.workspace.orchestrator.threads.seen.mutationOptions(),
  );
  const unseen = useMutation(
    rpcClient.workspace.orchestrator.threads.unseen.mutationOptions(),
  );
  const star = useMutation(
    rpcClient.workspace.orchestrator.threads.star.mutationOptions(),
  );
  // Hoisted, so each way's toast can name the other way back.
  function putAway(input: ThreadInput) {
    archive.mutate(input);
  }
  function bringBack(input: ThreadInput) {
    unarchive.mutate(input);
  }
  return (thread) => {
    const input = { id: taskId, sessionId: thread.id };
    const put: RowAction = thread.archived
      ? {
          icon: <ArrowCounterClockwiseIcon className="size-3.5" />,
          id: "unarchive",
          label: "Unarchive",
          run: () => {
            bringBack(input);
          },
        }
      : {
          icon: <ArchiveIcon className="size-3.5" />,
          id: "archive",
          label: "Archive",
          run: () => {
            putAway(input);
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
                seen.mutate(input);
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
                  unseen.mutate(input);
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
            star.mutate({ ...input, starred: false });
          },
        }
      : {
          icon: <StarIcon className="size-3.5" />,
          id: "star",
          label: "Star",
          run: () => {
            star.mutate({ ...input, starred: true });
          },
        };
    const rename: RowAction = {
      icon: <MagicWandIcon className="size-3.5" />,
      id: "rename",
      label: "Rename",
      menuOnly: true,
      run: () => {
        // The toast compares against the title the thread had when asked,
        // which only this call knows.
        retitle.mutate(input, {
          onSuccess: ({ title }) => {
            if (title === undefined) {
              toast("Nothing to name it from yet");
            } else if (title === thread.title) {
              toast("The name still fits");
            } else {
              toast(`Renamed to “${title}”`);
            }
          },
        });
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
    return [put, ...mark, { ...starred, menuOnly: true }, rename, save];
  };
}
