import { welcomeModalAtom } from "@/client/atoms/welcome-modal";
import { BrandLeafIcon } from "@/client/components/icons/brand-leaf";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import { useLiveSubscriptionStatus } from "@/client/hooks/use-live-subscription-status";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import {
  FileTextIcon,
  FloppyDiskIcon,
  GlobeSimpleIcon,
  type Icon,
  ListChecksIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useAtom } from "jotai";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { type PointerEvent, useState } from "react";

const FEATURE_ROWS: {
  body: string;
  Icon: Icon;
  title: string;
}[] = [
  {
    body: "Complete challenging multi-step tasks with AI",
    Icon: ListChecksIcon,
    title: "Go beyond chat replies.",
  },
  {
    body: `Work alongside ${APP_NAME} to craft documents, slides, spreadsheets, reports, and more`,
    Icon: FileTextIcon,
    title: "Create and edit files.",
  },
  {
    body: "Use the power of an AI agent to browse and act on the web for you",
    Icon: GlobeSimpleIcon,
    title: "Powerful onboard browser.",
  },
  {
    body: "Every task is a local folder you own, saved for offline use and versioned automatically",
    Icon: FloppyDiskIcon,
    title: "Emphatically native.",
  },
];

const POSITION_SPRING = { damping: 28, stiffness: 180 };

/**
 * App-wide welcome modal, mounted once at the app-chrome root. Reads
 * `welcomeModalAtom` (opened via `openWelcome`). Non-dismissible: the content
 * blocks Escape / outside-click and there's no close button, so it stays until
 * the user continues. Traps tab navigation while open.
 */
export function WelcomeModal() {
  const [state, setState] = useAtom(welcomeModalAtom);
  const isOpen = state !== null;
  // Deferred so `DialogContent` stays mounted (and its close animation can
  // play) for a moment after `state` clears to null, instead of unmounting
  // the instant the dialog starts closing.
  const { content, onExitComplete, openKey } = useDeferredModalState(state);

  useBlockTabNavigation(isOpen);

  return (
    // No onOpenChange: the content refuses Escape/outside dismiss, so the only
    // way out is Continue.
    <Dialog open={isOpen}>
      {content !== null && (
        <WelcomeModalContent
          key={openKey}
          onContinue={() => {
            setState(null);
          }}
          onExitComplete={onExitComplete}
        />
      )}
    </Dialog>
  );
}

function WelcomeHeader() {
  const prefersReducedMotion = useReducedMotion();
  const [isHovering, setIsHovering] = useState(false);

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);

  // Reduced motion: track the cursor instantly instead of springing.
  const springConfig = prefersReducedMotion
    ? { damping: 100, stiffness: 1000 }
    : POSITION_SPRING;
  const smoothX = useSpring(pointerX, springConfig);
  const smoothY = useSpring(pointerY, springConfig);
  // Intersect the spotlight with the static grid's falloff so revealed lines fade at the edges.
  const gridRevealMask = useMotionTemplate`
    radial-gradient(
      circle 7rem at ${smoothX}px ${smoothY}px,
      black 0%,
      transparent 70%
    ),
    radial-gradient(ellipse at 28% 10%, black 0%, transparent 64%)
  `;

  function trackPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();

    pointerX.set(event.clientX - rect.left);
    pointerY.set(event.clientY - rect.top);
  }

  return (
    <div
      className="relative flex w-full shrink-0 items-center justify-center overflow-hidden px-11 pt-15 pb-5"
      onPointerEnter={(event) => {
        // Snap to the entry point so the spotlight fades in under the cursor.
        const rect = event.currentTarget.getBoundingClientRect();

        pointerX.jump(event.clientX - rect.left);
        pointerY.jump(event.clientY - rect.top);
        setIsHovering(true);
      }}
      onPointerLeave={() => {
        setIsHovering(false);
      }}
      onPointerMove={trackPointer}
    >
      <div
        aria-hidden
        className="absolute -inset-x-7 top-0 h-49
          [background-image:linear-gradient(to_right,rgba(197,216,232,0.3)_1.2px,transparent_1.2px),linear-gradient(to_bottom,rgba(197,216,232,0.3)_1.2px,transparent_1.2px)]
          [mask-image:radial-gradient(ellipse_at_28%_10%,black_0%,transparent_64%)]
          [background-size:2rem_2rem]
          dark:[background-image:linear-gradient(to_right,color-mix(in_srgb,var(--gray-400)_10%,transparent)_1.2px,transparent_1.2px),linear-gradient(to_bottom,color-mix(in_srgb,var(--gray-400)_10%,transparent)_1.2px,transparent_1.2px)]"
      />
      <motion.div
        // Plain tween, quicker on the way out.
        animate={{ opacity: isHovering ? 1 : 0 }}
        aria-hidden
        className="pointer-events-none absolute -inset-x-7 top-0 h-49
          [background-image:linear-gradient(to_right,#6F9AC0_1.2px,transparent_1.2px),linear-gradient(to_bottom,#6F9AC0_1.2px,transparent_1.2px)]
          [background-size:2rem_2rem]"
        initial={{ opacity: 0 }}
        style={{
          maskComposite: "intersect",
          maskImage: gridRevealMask,
          WebkitMaskComposite: "source-in",
          WebkitMaskImage: gridRevealMask,
        }}
        transition={{ duration: isHovering ? 0.25 : 0.15, ease: "easeOut" }}
      />
      <h1 className="relative text-center font-serif text-3xl leading-10 font-normal text-gray-800 dark:text-gray-25">
        Explore the {APP_NAME}
        <br />
        Private Beta
      </h1>
    </div>
  );
}

function WelcomeModalContent({
  onContinue,
  onExitComplete,
}: {
  onContinue: () => void;
  onExitComplete: () => void;
}) {
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const { data: subscription } = useLiveSubscriptionStatus({
    input: { staleTime: 0 },
  });
  const showFreeUsageFooter = hasToken === true && subscription?.plan === null;

  // Navigates the active tab's router directly (the chrome renders inside its
  // RouterContextProvider), matching NavControls, rather than round-tripping a
  // tab command through the main process.
  const router = useRouter();

  async function handleContinue() {
    await router.navigate({ to: "/tutorial-task" });
    onContinue();
  }

  return (
    <DialogContent
      aria-describedby={undefined}
      className={cn(
        `flex max-h-[calc((100vh-3rem)/var(--content-zoom))]
        w-[calc((100vw-2.5rem)/var(--content-zoom))] max-w-xl flex-col gap-0
        overflow-hidden border-0 bg-gray-25 p-0
        shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)] drop-shadow-2xl outline-none
        focus:outline-none focus-visible:outline-none
        sm:max-w-xl dark:bg-gray-800
        dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]`,
      )}
      onEscapeKeyDown={(event) => {
        event.preventDefault();
      }}
      onExitComplete={onExitComplete}
      onInteractOutside={(event) => {
        event.preventDefault();
      }}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
      }}
      showCloseButton={false}
    >
      <DialogTitle className="sr-only">
        Explore the {APP_NAME} Private Beta
      </DialogTitle>

      <WelcomeHeader />

      <div className="flex min-h-0 flex-1 flex-col items-center gap-8 px-11 pt-7 pb-10">
        <div className="min-h-0 w-full overflow-y-auto pr-1">
          <div className="flex w-full flex-col gap-5">
            <div className="flex w-full flex-col gap-2">
              {FEATURE_ROWS.map(({ body, Icon, title }) => (
                <div
                  className="flex w-full items-start gap-4 border-b border-black/5 pb-4 dark:border-white/10"
                  key={title}
                >
                  <Icon
                    className="size-8 shrink-0 text-brand-400"
                    weight="regular"
                  />
                  <p className="min-w-0 flex-1 text-base leading-6 text-gray-500">
                    <span className="font-medium text-brand-600 dark:text-brand-400">
                      {title}
                    </span>{" "}
                    {body}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex w-full flex-col gap-1">
              <p className="text-base leading-6 font-medium text-brand-600 dark:text-brand-400">
                Coming soon to {APP_NAME}
              </p>
              <p className="text-sm leading-5 text-gray-500">
                bring in data from your apps and services · custom skills ·
                persistent memory and files in agent-maintained cloud storage ·
                team collaboration tools · and much more · rolling out over the
                beta
              </p>
            </div>
          </div>
        </div>

        <Button
          className="rounded-lg text-base leading-6"
          onClick={() => {
            void handleContinue();
          }}
          size="lg"
          type="button"
          variant="brand"
        >
          Continue
        </Button>
      </div>

      {showFreeUsageFooter && (
        <div className="shrink-0 border-t border-black/5 bg-[radial-gradient(ellipse_120%_220%_at_24%_-35%,color-mix(in_srgb,var(--brand-400)_16%,transparent)_0%,transparent_72%)] px-11 pt-7 pb-9 dark:bg-[radial-gradient(ellipse_120%_220%_at_24%_-35%,color-mix(in_srgb,var(--brand-400)_10%,transparent)_0%,transparent_72%)]">
          <div className="flex flex-col gap-1">
            <div className="flex w-full items-center gap-2">
              <BrandLeafIcon className="size-3" />
              <p className="text-sm leading-5 font-semibold text-brand-600 dark:text-brand-400">
                Enjoy free AI usage for a limited time
              </p>
            </div>
            <p className="text-sm leading-5 text-black/70 dark:text-white/50">
              As a gift for being among our earliest users, {APP_NAME} includes
              free AI usage so you can try the app. Enjoy!
            </p>
          </div>
        </div>
      )}
    </DialogContent>
  );
}
