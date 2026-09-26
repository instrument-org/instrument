import { getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient, type RPCInput } from "@/client/rpc/client";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

export type TranscriptFormat = RPCInput["transcript"]["save"]["format"];

/** Which session a call is about, when it is not the one the hook was given. */
interface Target {
  label?: string;
  sessionId: StoreId.Session;
}

/**
 * Copy and save for a session's transcript, in whichever format is asked for.
 *
 * Both go straight from the main process to the OS: the content is the largest
 * thing the app moves, and neither action has any use for it here. That also
 * keeps them callable from a menu item, with no viewer mounted and nothing
 * fetched.
 *
 * Saving is offered to everyone; copying is behind developer mode, so a caller
 * outside it wants `save` alone.
 */
export function useTranscriptActions({
  id,
  label,
  sessionId,
}: {
  id: TaskId;
  /** What the saved file is named after, where the task's name is not it: a channel's, say. */
  label?: string;
  sessionId: StoreId.Session | undefined;
}) {
  const { mutate: showFileInFolder } = useMutation(
    rpcClient.utils.showFileInFolder.mutationOptions(),
  );

  // The stable `mutate` and the flag rather than the mutation objects, which
  // are new on every render: a list that saves through this hook memoizes on
  // what it returns.
  const { isPending: isCopying, mutate: copy } = useMutation(
    rpcClient.transcript.copy.mutationOptions({
      onError: (error) => {
        toast.error("Failed to copy transcript", {
          description: error.message,
        });
      },
      onSuccess: () => {
        toast.success("Transcript copied to clipboard");
      },
    }),
  );

  const { isPending: isSaving, mutate: save } = useMutation(
    rpcClient.transcript.save.mutationOptions({
      onError: (error) => {
        toast.error("Failed to save transcript", {
          description: error.message,
        });
      },
      onSuccess: (result) => {
        // Ordinary duration, no close button: the save is already done and its
        // path is already on the clipboard, so there is nothing here to come
        // back to and nothing lost by looking away. The filename is left out
        // for the same reason -- the button goes to the file and the clipboard
        // holds its path, so it would only be a long string to wrap.
        toast.success("Transcript saved to Downloads", {
          action: {
            label: getRevealInFolderLabel(),
            onClick: () => {
              showFileInFolder({ filepath: result.filepath });
            },
          },
          description: "Path copied to clipboard",
        });
      },
    }),
  );

  // The session and label the hook was given, or the ones a call names: a
  // list of sessions saves any of them through one instance rather than one
  // per row.
  const targetOf = (target?: Target) => {
    const name = target?.label ?? label;
    const session = target?.sessionId ?? sessionId;
    return session
      ? {
          id,
          sessionId: session,
          ...(name === undefined ? {} : { label: name }),
        }
      : undefined;
  };

  return {
    copy: (format: TranscriptFormat, target?: Target) => {
      const input = targetOf(target);
      if (input) {
        copy({ format, ...input });
      }
    },
    isCopying,
    isSaving,
    save: (format: TranscriptFormat, target?: Target) => {
      const input = targetOf(target);
      if (input) {
        save({ format, ...input });
      }
    },
  };
}
