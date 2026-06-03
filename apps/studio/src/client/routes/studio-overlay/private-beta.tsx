import { BrandLeafIcon } from "@/client/components/icons/brand-leaf";
import { Button } from "@/client/components/ui/button";
import { DialogContent, DialogTitle } from "@/client/components/ui/dialog";
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
import { createFileRoute } from "@tanstack/react-router";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { type PointerEvent, useState } from "react";

export const Route = createFileRoute("/studio-overlay/private-beta")({
  component: PrivateBetaModal,
});

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

function PrivateBetaHeader() {
  const prefersReducedMotion = useReducedMotion();
  const [isHovering, setIsHovering] = useState(false);

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);

  // When reduced motion is requested, track the cursor instantly instead of
  // springing the spotlight across the header.
  const springConfig = prefersReducedMotion
    ? { damping: 100, stiffness: 1000 }
    : POSITION_SPRING;
  const smoothX = useSpring(pointerX, springConfig);
  const smoothY = useSpring(pointerY, springConfig);
  // Intersect the cursor spotlight with a bottom edge-fade so the last rows of
  // grid lines never finish abruptly when the cursor hovers near the bottom.
  const gridRevealMask = useMotionTemplate`
    radial-gradient(
      circle 7rem at ${smoothX}px ${smoothY}px,
      black 0%,
      transparent 70%
    ),
    linear-gradient(to bottom, black 0%, black 70%, transparent 100%)
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
        // Snap the spotlight to the entry point so it fades in under the
        // cursor instead of sweeping in from the top-left corner.
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
        className={cn(
          `absolute -inset-x-7 top-0 h-49
          [background-image:linear-gradient(to_right,color-mix(in_srgb,var(--brand-300)_10%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--brand-300)_10%,transparent)_1px,transparent_1px)]
          [mask-image:radial-gradient(ellipse_at_28%_10%,black_0%,transparent_64%)]
          [background-size:2rem_2rem]
          dark:[background-image:linear-gradient(to_right,color-mix(in_srgb,var(--gray-400)_10%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--gray-400)_10%,transparent)_1px,transparent_1px)]`,
        )}
      />
      <motion.div
        // A plain tween reads cleaner than a spring for a simple fade, and a
        // quicker fade-out feels snappier when the cursor leaves the header.
        animate={{ opacity: isHovering ? 1 : 0 }}
        aria-hidden
        className={cn(
          `pointer-events-none absolute -inset-x-7 top-0 h-49
          [background-image:linear-gradient(to_right,color-mix(in_srgb,var(--brand-300)_38%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--brand-300)_38%,transparent)_1px,transparent_1px)]
          [background-size:2rem_2rem]
          dark:[background-image:linear-gradient(to_right,color-mix(in_srgb,var(--gray-300)_34%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--gray-300)_34%,transparent)_1px,transparent_1px)]`,
        )}
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

function PrivateBetaModal() {
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const { data: subscription } = useLiveSubscriptionStatus({
    input: { staleTime: 0 },
  });
  const showFreeUsageFooter = hasToken === true && subscription?.plan === null;

  async function handleContinue() {
    await rpcClient.tabs.navigate.call({ appPath: "/tutorial-task" });
    await rpcClient.studioOverlay.resolve.call();
  }

  return (
    <DialogContent
      className={cn(
        `flex max-h-[calc(100vh-3rem)] w-[calc(100vw-2.5rem)] max-w-xl flex-col gap-0 overflow-hidden
        rounded-3xl border-0 bg-gray-25 p-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)] drop-shadow-2xl
        outline-none focus:outline-none focus-visible:outline-none
        sm:max-w-xl dark:bg-gray-800
        dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]`,
      )}
      onEscapeKeyDown={(event) => {
        event.preventDefault();
      }}
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

      <PrivateBetaHeader />

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
                    className="size-8 shrink-0 text-brand-300"
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
                app connectors · plain text skills and memory written to
                agent-maintained cloud storage · powerful collaboration tools ·
                and much more · rolling out over the beta
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
