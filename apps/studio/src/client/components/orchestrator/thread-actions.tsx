import { useTranscriptActions } from "@/client/components/task/transcript-actions";
import { rpcClient } from "@/client/rpc/client";
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

/**
 * What a thread offers that no line of it carries, in the order the row's
 * edge and its menu list them: putting it away, or back in the inbox, with
 * an undo in the toast either way; marking it read while something in it
 * is unseen, or unread again once it has replies to be unread, with no
 * toast at all, since the row itself says which it is; and, in the menu
 * alone, starring it, naming it again from where its conversation stands
 * (the same call that names it after each finished turn), and saving its
 * transcript.
 */
export function useThreadActions(thread: Thread): RowAction[] {
  const { taskId } = useOrchestrator();
  const input = { id: taskId, sessionId: thread.id };
  const retitle = useMutation(
    rpcClient.workspace.orchestrator.threads.retitle.mutationOptions({
      onError: (error) => {
        toast.error("Failed to rename the thread", {
          description: error.message,
        });
      },
      onSuccess: ({ title }) => {
        if (title === undefined) {
          toast("Nothing to name it from yet");
        } else if (title === thread.title) {
          toast("The name still fits");
        } else {
          toast(`Renamed to “${title}”`);
        }
      },
    }),
  );
  const transcript = useTranscriptActions({
    id: taskId,
    label: thread.title,
    sessionId: thread.id,
  });
  // Each way's toast offers the other way back, so an undo can be undone.
  // The toasts hang off the mutations rather than off the calls, since the
  // row is gone from the list by the time either lands.
  const archive = useMutation(
    rpcClient.workspace.orchestrator.threads.archive.mutationOptions({
      onError: (error) => {
        toast.error("Failed to archive the thread", {
          description: error.message,
        });
      },
      onSuccess: () => {
        toast("Archived", { action: { label: "Undo", onClick: bringBack } });
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
      onSuccess: () => {
        toast("Moved to Inbox", {
          action: { label: "Undo", onClick: putAway },
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
  function putAway() {
    archive.mutate(input);
  }
  function bringBack() {
    unarchive.mutate(input);
  }
  const put: RowAction = thread.archived
    ? {
        icon: <ArrowCounterClockwiseIcon className="size-3.5" />,
        id: "unarchive",
        label: "Unarchive",
        run: bringBack,
      }
    : {
        icon: <ArchiveIcon className="size-3.5" />,
        id: "archive",
        label: "Archive",
        run: putAway,
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
      retitle.mutate(input);
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
      transcript.save("markdown");
    },
  };
  return [put, ...mark, { ...starred, menuOnly: true }, rename, save];
}
