import { toast } from "@/client/lib/toast";
import { extensionInstallModalAtom } from "@/client/atoms/extension-install-modal";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useEffect } from "react";

/**
 * The question before an extension is added, or when one asks to be allowed
 * more, as Chrome's own: the extension by icon and name, what it will be able
 * to do in a person's words, and Add or Allow beside Cancel. Main asks every window; this one opens
 * on the ask, answers it, and closes when any window has.
 */
export function ExtensionInstallModal() {
  const [state, setState] = useAtom(extensionInstallModalAtom);
  const { content, onExitComplete, openKey } = useDeferredModalState(state);
  const { data: asked } = useQuery(
    rpcClient.browserExtensions.events.installAsked.experimental_liveOptions(),
  );
  const { data: answered } = useQuery(
    rpcClient.browserExtensions.events.installAnswered.experimental_liveOptions(),
  );
  useEffect(() => {
    if (asked) {
      setState(asked);
    }
  }, [asked, setState]);
  const askId = state?.askId;
  useEffect(() => {
    if (answered && answered.askId === askId) {
      setState(null);
    }
  }, [answered, askId, setState]);

  // Another modal taking this one's place refuses the ask, as Cancel does.
  // An answer already given is settled, so this changes nothing after one.
  useEffect(() => {
    if (askId === undefined) {
      return;
    }
    return () => {
      void rpcClient.browserExtensions.answerInstall
        .call({ allow: false, askId })
        .catch(() => {
          // The ask is over already, or the main process is gone with it.
        });
    };
  }, [askId]);

  const answer = (allow: boolean) => {
    if (state) {
      void rpcClient.browserExtensions.answerInstall
        .call({ allow, askId: state.askId })
        .catch((error: unknown) => {
          toast.error(
            allow ? "Couldn't add the extension" : "Couldn't send your answer",
            { cause: error },
          );
        });
    }
    setState(null);
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          answer(false);
        }
      }}
      open={state !== null}
    >
      {content !== null && (
        <DialogContent
          key={openKey}
          maxWidth="30rem"
          onExitComplete={onExitComplete}
        >
          <DialogBody>
            <div className="flex items-start gap-3">
              {content.icon && (
                <img alt="" className="size-10 shrink-0" src={content.icon} />
              )}
              <div className="flex min-w-0 flex-col gap-2">
                <DialogTitle>
                  {content.kind === "add"
                    ? `Add “${content.name}” to ${APP_NAME}?`
                    : `Allow “${content.name}” to do more?`}
                </DialogTitle>
                <DialogDescription>
                  {content.lines.length > 0
                    ? "It will be able to:"
                    : "It doesn't require any special permissions."}
                </DialogDescription>
                {content.lines.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {content.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              onClick={() => {
                answer(false);
              }}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                answer(true);
              }}
              variant="brand"
            >
              {content.kind === "add" ? "Add extension" : "Allow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
