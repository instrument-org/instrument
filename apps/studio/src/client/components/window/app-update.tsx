import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useWindow } from "@/client/components/window/context";
import {
  FixWithInstrumentButton,
  useFixConnection,
} from "@/client/components/window/fix-connection";
import {
  SignInButton,
  SignInWaitingLine,
} from "@/client/components/window/sign-in-button";
import {
  type SignInDestination,
  signInsWaitingAtom,
} from "@/client/components/window/use-sign-in-landing";
import { useModalBack } from "@/client/hooks/use-modal-back";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { toast } from "@/client/lib/toast";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useState } from "react";

type App = RPCOutput["apps"]["list"]["apps"][number];

type AppUpdate = NonNullable<Extract<App, { type: "web" }>["update"]>;

/** Where a connected account with an update stands. */
export function AppUpdateLine({
  name,
  update,
}: {
  name: string;
  update: AppUpdate;
}) {
  if (update.opensIn !== undefined) {
    return <SignInWaitingLine where={update.opensIn} />;
  }
  switch (update.ended?.ended) {
    case "failed": {
      return "Connected · The update didn’t finish";
    }
    case "refused": {
      return `Connected · ${name} didn’t allow the update`;
    }
    case "declined":
    case "expired":
    case undefined: {
      return "Connected · Update available";
    }
  }
}

/**
 * Update on an account Instrument works by opening its site in a tab, for a
 * service it can sign in to directly. The account works either way, so its
 * row never asks for a sign-in: the button opens a dialog that says what the
 * update is, and the sign-in is there. A service that refused it would refuse
 * it again, so that leaves only the fix.
 */
export function AppUpdateControls({
  name,
  slug,
  update,
}: {
  name: string;
  slug: string;
  update: AppUpdate;
}) {
  const { browser, chatId, openPage } = useWindow();
  const openExternalLink = useOpenExternalLink();
  const setSignInsWaiting = useSetAtom(signInsWaitingAtom);
  const [isOpen, setIsOpen] = useState(false);
  useModalBack(() => {
    setIsOpen(false);
  }, isOpen);
  const { ended, opensIn } = update;
  const { fix } = useFixConnection({
    ask: (app) =>
      `Updating ${app} to sign in directly didn't work${ended?.error ? ` (${ended.error})` : ""}. It still works in a tab. Look for another way to update it.`,
    name,
    slug,
    updatedAt: ended?.at,
  });
  const startUpdate = useMutation(
    rpcClient.apps.startUpdate.mutationOptions({
      onError: (error) => {
        toast.error(`Couldn't update ${name}`, { cause: error });
      },
      onSettled: () => {
        setIsOpen(false);
      },
    }),
  );
  const cancelOAuth = useMutation(rpcClient.apps.cancelOAuth.mutationOptions());
  const start = (where: SignInDestination) => {
    const opens = browser ? where : "external";
    startUpdate.mutate(
      { opensIn: opens, slug },
      {
        onSuccess: ({ url }) => {
          setSignInsWaiting((current) =>
            new Map(current).set(slug, {
              from: ended?.at,
              inChat: chatId !== undefined,
              isUpdate: true,
              where: opens,
            }),
          );
          if (opens === "app") {
            openPage(url);
          } else {
            openExternalLink(url, { addReferral: false });
          }
        },
      },
    );
  };
  const cancel = () => {
    setSignInsWaiting((current) => {
      const next = new Map(current);
      next.delete(slug);
      return next;
    });
    cancelOAuth.mutate({ slug });
  };
  const isWaiting = opensIn !== undefined;
  const isFailed = ended?.ended === "failed";
  if (!isWaiting && ended?.ended === "refused") {
    return <FixWithInstrumentButton onClick={fix} />;
  }
  return (
    <>
      {isWaiting ? (
        <Button
          className="text-foreground"
          onClick={cancel}
          size="sm"
          variant="outline"
        >
          Cancel
        </Button>
      ) : isFailed ? (
        <FixWithInstrumentButton onClick={fix} />
      ) : null}
      <Button
        className="text-foreground"
        disabled={isWaiting}
        onClick={() => {
          setIsOpen(true);
        }}
        size="sm"
        variant="outline"
      >
        {isFailed && !isWaiting ? "Try again" : "Update"}
      </Button>
      <Dialog onOpenChange={setIsOpen} open={isOpen}>
        <DialogContent maxWidth="28rem" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Update {name}</DialogTitle>
            <DialogDescription>
              Instrument will work in {name} without opening it in a tab. You’ll
              sign in to {name} once more.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              className="text-foreground"
              onClick={() => {
                setIsOpen(false);
              }}
              size="sm"
              variant="outline"
            >
              Not now
            </Button>
            <SignInButton
              busy={startUpdate.isPending}
              canSignInHere={Boolean(browser)}
              onCancel={cancel}
              onStart={start}
              variant="brand"
              waiting={false}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
