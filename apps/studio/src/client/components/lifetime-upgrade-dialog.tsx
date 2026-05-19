import { AppIconStylized } from "@/client/components/app-icon-stylized";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useLiveEntitlements } from "@/client/hooks/use-live-entitlements";
import { captureClientEvent } from "@/client/lib/capture-client-event";
import { SHARED } from "@/client/lib/styles";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { CheckIcon, HeartIcon, XIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

const LIFETIME_PRICE_USD = 99;

const FEATURES = [
  `Use ${APP_NAME} forever`,
  "2x rate limits during Beta",
  "Bring your own AI keys",
  "Priority founder support",
];

const fadeInitial = { opacity: 0 };
const fadeAnimate = { opacity: 1 };
const fadeTransition = { duration: 0.4, ease: "easeOut" as const };

export function LifetimeUpgradeDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [hasStartedCheckout, setHasStartedCheckout] = useState(false);

  const { data: entitlements } = useLiveEntitlements();
  const hasLifetime = entitlements?.lifetime ?? false;
  const showSuccess = hasStartedCheckout && hasLifetime;

  const { mutateAsync: createLifetimeCheckoutSession } = useMutation(
    rpcClient.stripe.createLifetimeCheckoutSession.mutationOptions(),
  );
  const { mutateAsync: openExternalLink } = useMutation(
    rpcClient.utils.openExternalLink.mutationOptions(),
  );

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setHasStartedCheckout(false);
    }
    onOpenChange(next);
  };

  const handleCheckout = async () => {
    captureClientEvent("subscribe.lifetime_clicked");
    setIsLoading(true);
    try {
      const { url } = await createLifetimeCheckoutSession();
      if (!url) {
        toast.error("Failed to start checkout");
        return;
      }
      await openExternalLink({ url });
      setHasStartedCheckout(true);
    } catch {
      toast.error("Failed to start checkout");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className={cn(
          `flex h-140 max-h-[85vh] w-full max-w-100 flex-col overflow-hidden
          rounded-3xl border-0 p-0 shadow-[inset_0_0_0_2px_rgba(0,0,0,0.05)]
          sm:max-w-100
          dark:shadow-[inset_0_0_0_2px_rgba(255,255,255,0.05)]`,
          SHARED.brandGradient,
        )}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>
            {showSuccess ? "Welcome, Founding User" : "Founding User"}
          </DialogTitle>
          <DialogDescription>
            {showSuccess
              ? `Your lifetime access to ${APP_NAME} is active.`
              : `Exclusive Private Beta offer. Pay $${LIFETIME_PRICE_USD} once to use ${APP_NAME} forever.`}
          </DialogDescription>
        </DialogHeader>

        <div className="absolute top-3 right-3 z-10">
          <DialogClose asChild>
            <Button aria-label="Close" type="button" variant="outline">
              <XIcon className="size-4" />
            </Button>
          </DialogClose>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          <AnimatePresence initial={false} mode="wait">
            {showSuccess ? (
              <motion.div
                animate={fadeAnimate}
                className="flex flex-1 flex-col"
                exit={fadeInitial}
                initial={fadeInitial}
                key="success"
                transition={fadeTransition}
              >
                <SuccessContent
                  onClose={() => {
                    handleOpenChange(false);
                  }}
                />
              </motion.div>
            ) : (
              <motion.div
                animate={fadeAnimate}
                className="flex flex-1 flex-col"
                exit={fadeInitial}
                initial={fadeInitial}
                key="offer"
                transition={fadeTransition}
              >
                <OfferContent
                  isLoading={isLoading}
                  onCheckout={() => void handleCheckout()}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OfferContent({
  isLoading,
  onCheckout,
}: {
  isLoading: boolean;
  onCheckout: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="flex w-full flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-5">
          <AppIconStylized className="size-20" />

          <div className="flex flex-col items-center gap-1 text-center">
            <h1
              className="font-serif text-3xl font-medium tracking-tight
                text-foreground"
            >
              Founding User
            </h1>
            <div className="text-4xl font-semibold text-foreground">
              {`$${LIFETIME_PRICE_USD}`}
            </div>
            <p className="mt-1 text-sm font-semibold text-foreground/80">
              Exclusive Private Beta offer
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-5">
          <ul className="flex flex-col gap-2.5">
            {FEATURES.map((feature) => (
              <li
                className="flex items-start gap-2 text-sm text-foreground/85"
                key={feature}
              >
                <CheckIcon
                  className="mt-0.5 size-4 shrink-0 text-brand-500"
                  weight="bold"
                />
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          <Button
            className="justify-center px-8 font-semibold"
            disabled={isLoading}
            onClick={onCheckout}
            size="lg"
            variant="brand"
          >
            {isLoading ? "Opening checkout..." : "Purchase Founding User"}
          </Button>

          <div className="flex items-center justify-center gap-1.5">
            <HeartIcon className="size-3.5 text-foreground/50" weight="fill" />
            <p className="text-xs text-foreground/60">
              Thanks for supporting independent founders
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SuccessContent({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="flex w-full flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-5">
          <motion.div
            animate={fadeAnimate}
            initial={fadeInitial}
            transition={{ ...fadeTransition, delay: 0.1 }}
          >
            <AppIconStylized className="size-20" />
          </motion.div>

          <motion.div
            animate={fadeAnimate}
            className="flex flex-col items-center gap-1.5 text-center"
            initial={fadeInitial}
            transition={{ ...fadeTransition, delay: 0.2 }}
          >
            <h1
              className="font-serif text-3xl font-medium tracking-tight
                text-foreground"
            >
              You&apos;re in
            </h1>
            <p className="max-w-xs text-sm text-foreground/80">
              Your Founding User access is active.
            </p>
          </motion.div>
        </div>

        <motion.div
          animate={fadeAnimate}
          className="flex flex-col items-center gap-4"
          initial={fadeInitial}
          transition={{ ...fadeTransition, delay: 0.3 }}
        >
          <Button onClick={onClose}>Continue</Button>
        </motion.div>
      </div>
    </div>
  );
}
