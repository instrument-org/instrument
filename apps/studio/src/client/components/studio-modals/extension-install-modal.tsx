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
 * The Chrome Web Store's question before an extension is added, as Chrome's
 * own: the extension by icon and name, what it will be able to do in a
 * person's words, and Add or Cancel. Main asks every window; this one opens
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
  useEffect(() => {
    if (answered) {
      setState(null);
    }
  }, [answered, setState]);

  const answer = (allow: boolean) => {
    if (state) {
      void rpcClient.browserExtensions.answerInstall
        .call({ allow, askId: state.askId })
        .catch(() => {});
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
              <img alt="" className="size-10 shrink-0" src={content.icon} />
              <div className="flex min-w-0 flex-col gap-2">
                <DialogTitle>
                  Add “{content.name}” to {APP_NAME}?
                </DialogTitle>
                <DialogDescription>
                  {content.lines.length > 0
                    ? "It will be able to:"
                    : "It asks for nothing beyond running in the browser."}
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
              Add extension
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
