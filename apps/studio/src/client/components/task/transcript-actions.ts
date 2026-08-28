import { getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient, type RPCInput } from "@/client/rpc/client";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

export type TranscriptFormat = RPCInput["debug"]["sessionTranscript"]["format"];

/**
 * Copy and save for a session's transcript, in whichever format is asked for.
 *
 * Both go straight from the main process to the OS: the content is the largest
 * thing the app moves, and neither action has any use for it here. That also
 * keeps them callable from a menu item, with no viewer mounted and nothing
 * fetched.
 */
export function useTranscriptActions({
  id,
  sessionId,
}: {
  id: TaskId;
  sessionId: StoreId.Session | undefined;
}) {
  const showFileInFolder = useMutation(
    rpcClient.utils.showFileInFolder.mutationOptions(),
  );

  const copy = useMutation(
    rpcClient.debug.copySessionTranscript.mutationOptions({
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

  const save = useMutation(
    rpcClient.debug.saveSessionTranscript.mutationOptions({
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
              showFileInFolder.mutate({ filepath: result.filepath });
            },
          },
          description: "Path copied to clipboard",
        });
      },
    }),
  );

  return {
    copy: (format: TranscriptFormat) => {
      if (sessionId) {
        copy.mutate({ format, id, sessionId });
      }
    },
    isCopying: copy.isPending,
    isSaving: save.isPending,
    save: (format: TranscriptFormat) => {
      if (sessionId) {
        save.mutate({ format, id, sessionId });
      }
    },
  };
}
