import { openSettings } from "@/client/atoms/settings-modal";
import { Button } from "@/client/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/client/components/ui/hover-card";
import { Spinner } from "@/client/components/ui/spinner";
import { useAppTabs } from "@/client/components/window/app-tabs";
import { useNow } from "@/client/components/window/use-now";
import { formatRelativeTime } from "@/client/lib/relative-time";
import { cn } from "@/client/lib/utils";
import {
  showsAsRestarting,
  useInstallAsksForPassword,
  useInstallsUnattended,
  useInstallUpdate,
} from "@/client/components/use-install-update";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/ArrowsClockwise";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import ms from "ms";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { toast } from "@/client/lib/toast";

const PROGRESS_RING_CIRCUMFERENCE = 44;
const NOT_AVAILABLE_BADGE_TIMEOUT_MS = 5000;
const ICON_CLASS_NAME = "size-3.5";
const PROGRESS_ICON_CLASS_NAME = "size-3";

const MUTED_TRIGGER_CLASS_NAME =
  "border-black/5 bg-background text-muted-foreground hover:bg-muted dark:border-white/10";

type UpdateStatusBadgeState =
  | {
      message?: string;
      type: "error";
    }
  | {
      progress: number;
      type: "downloading";
    }
  | {
      type: "checking";
    }
  | {
      type: "downloaded";
      version?: string;
    }
  | {
      type: "installing";
    }
  | {
      type: "not-available";
    };

// Single source of truth for each rendered badge: its trigger styling, label,
// and whether it's manual-only (a silent background poll of these stays in
// Settings, no toolbar pill, unless the user ran the check). Keyed by the badge
// union so adding a state is one entry and the compiler enforces completeness.
const BADGE_META = {
  checking: {
    className: MUTED_TRIGGER_CLASS_NAME,
    label: "Checking",
    manualOnly: true,
  },
  downloaded: {
    className:
      "border-transparent bg-brand-600 text-brand-foreground hover:bg-brand-700",
    label: "Update",
    manualOnly: false,
  },
  // A download the app started on its own goes unseen; one the person asked
  // for (Settings, the menu) shows its progress.
  downloading: {
    className: MUTED_TRIGGER_CLASS_NAME,
    label: "Updating",
    manualOnly: true,
  },
  error: {
    className:
      "border-destructive/25 bg-background text-destructive hover:bg-destructive/10 dark:border-destructive/35 dark:hover:bg-destructive/20",
    label: "Update issue",
    manualOnly: true,
  },
  installing: {
    className: MUTED_TRIGGER_CLASS_NAME,
    label: "Restarting",
    manualOnly: false,
  },
  "not-available": {
    className:
      "border-black/5 bg-background text-muted-foreground dark:border-white/10",
    label: "Up to date",
    manualOnly: true,
  },
} satisfies Record<
  UpdateStatusBadgeState["type"],
  { className: string; label: string; manualOnly: boolean }
>;

export function UpdateStatusIndicator() {
  const { data: updateState } = useQuery(
    rpcClient.updates.live.status.experimental_liveOptions(),
  );
  const { install, restarting } = useInstallUpdate(updateState?.type);
  // A manual "up to date" result auto-hides after a beat so it's transient
  // feedback, not persistent chrome.
  const [dismissedNotAvailable, setDismissedNotAvailable] = useState(false);

  const isManualNotAvailable =
    updateState?.type === "not-available" && updateState.notifyUser;

  // Re-arm the dismissal on every transition into/out of the manual state during
  // render (the pattern React allows over a cascading effect), so each new manual
  // check shows the pill again before the timer below hides it.
  const [trackedManualNotAvailable, setTrackedManualNotAvailable] =
    useState(isManualNotAvailable);
  if (trackedManualNotAvailable !== isManualNotAvailable) {
    setTrackedManualNotAvailable(isManualNotAvailable);
    setDismissedNotAvailable(false);
  }

  useEffect(() => {
    if (!isManualNotAvailable) {
      return;
    }
    const timeout = setTimeout(() => {
      setDismissedNotAvailable(true);
    }, NOT_AVAILABLE_BADGE_TIMEOUT_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [isManualNotAvailable]);

  const badgeState = updateState
    ? getBadgeState({
        errorMessage:
          updateState.type === "error" ? updateState.message : undefined,
        progress:
          updateState.type === "downloading"
            ? Math.round(updateState.progress.percent)
            : undefined,
        status: updateState.type,
        version:
          "updateInfo" in updateState
            ? updateState.updateInfo?.version
            : undefined,
      })
    : null;

  const handleClick = () => {
    void (async () => {
      if (updateState?.type === "downloaded") {
        const [error, result] = await install();
        if (error) {
          toastInstallFailure(error);
          return;
        }
        // A failed install, a declined password prompt among them, leaves the
        // app running on the version it had.
        if (result.type === "failed") {
          toastInstallFailure(new Error(result.message));
          return;
        }
        // The badge has no copy beside it, so a pre-install check that found a
        // newer release has to say so or the click looks like it did nothing.
        // The second line is the important one: nothing restarts until they ask
        // again, however long the download takes.
        if (result.type === "deferred") {
          toast.info(`Getting version ${result.version} instead`, {
            description:
              "A newer version was just released. You can install it once the download finishes.",
          });
        }
        return;
      }

      openSettings({ tab: "General" });
    })();
  };

  // Hidden when: no badge for this status; a silent background poll of a
  // manual-only status; or the auto-dismissed manual "up to date" pill.
  const visibleBadge: null | UpdateStatusBadgeState = showsAsRestarting(
    restarting,
    updateState?.type,
  )
    ? { type: "installing" }
    : updateState &&
        badgeState &&
        !(BADGE_META[badgeState.type].manualOnly && !updateState.notifyUser) &&
        !(dismissedNotAvailable && isManualNotAvailable)
      ? badgeState
      : null;

  return (
    <AnimatePresence initial={false} mode="wait">
      {visibleBadge && (
        <motion.div
          animate={{ opacity: 1, x: 0 }}
          className="inline-flex h-5 items-center"
          exit={{ opacity: 0, x: 6 }}
          initial={{ opacity: 0, x: 10 }}
          key={visibleBadge.type}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          {visibleBadge.type === "downloaded" ? (
            <UpdateReadyCard
              onRestart={handleClick}
              version={visibleBadge.version}
            >
              <UpdateStatusBadge onClick={handleClick} state={visibleBadge} />
            </UpdateReadyCard>
          ) : (
            <UpdateStatusBadge onClick={handleClick} state={visibleBadge} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CircularProgressIcon({
  progress,
  sizeClassName = "size-4",
}: {
  progress: number;
  sizeClassName?: string;
}) {
  const normalizedProgress = Math.min(Math.max(progress, 0), 100);
  const strokeDashoffset =
    PROGRESS_RING_CIRCUMFERENCE -
    (normalizedProgress / 100) * PROGRESS_RING_CIRCUMFERENCE;

  return (
    <svg
      aria-hidden="true"
      className={cn("-rotate-90", sizeClassName)}
      fill="none"
      viewBox="0 0 16 16"
    >
      <circle
        className="stroke-current opacity-20"
        cx="8"
        cy="8"
        r="7"
        strokeWidth="2"
      />
      <circle
        className="stroke-current transition-[stroke-dashoffset]"
        cx="8"
        cy="8"
        r="7"
        strokeDasharray={PROGRESS_RING_CIRCUMFERENCE}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function getAriaLabel(state: UpdateStatusBadgeState) {
  switch (state.type) {
    case "checking": {
      return "Checking for updates";
    }
    case "downloaded": {
      return state.version ? `Update ${state.version} ready` : "Update ready";
    }
    case "downloading": {
      return "Downloading update";
    }
    case "error": {
      return state.message
        ? `Update failed: ${state.message}`
        : "Update failed";
    }
    case "installing": {
      return "Restarting to update";
    }
    case "not-available": {
      return "No updates available";
    }
  }
}

// The one place raw updater status strings become a typed badge; everything
// downstream keys off {@link BADGE_META} via the returned union. `available`
// renders as downloading at 0% so the badge never blanks between the check and
// the first progress event (autoDownload is always on). Returns null for
// statuses that get no toolbar pill (canceled, inactive).
function getBadgeState({
  errorMessage,
  progress,
  status,
  version,
}: {
  errorMessage: string | undefined;
  progress: number | undefined;
  status: string;
  version: string | undefined;
}): null | UpdateStatusBadgeState {
  switch (status) {
    case "available": {
      return {
        progress: progress ?? 0,
        type: "downloading",
      };
    }
    case "checking": {
      return {
        type: "checking",
      };
    }
    case "downloaded": {
      return {
        type: "downloaded",
        version,
      };
    }
    case "downloading": {
      return {
        progress: progress ?? 0,
        type: "downloading",
      };
    }
    case "error": {
      return {
        message: errorMessage,
        type: "error",
      };
    }
    case "installing": {
      return {
        type: "installing",
      };
    }
    case "not-available": {
      return {
        type: "not-available",
      };
    }
    default: {
      return null;
    }
  }
}

function renderTriggerIcon(state: UpdateStatusBadgeState) {
  if (state.type === "checking") {
    return <Spinner className="size-3" delay={0} />;
  }

  if (state.type === "downloading") {
    return (
      <CircularProgressIcon
        progress={state.progress}
        sizeClassName={PROGRESS_ICON_CLASS_NAME}
      />
    );
  }

  if (state.type === "installing") {
    return <Spinner className="size-3" delay={0} />;
  }

  if (state.type === "error") {
    return <WarningCircleIcon className={ICON_CLASS_NAME} weight="fill" />;
  }

  if (state.type === "not-available") {
    return <CheckCircleIcon className={ICON_CLASS_NAME} weight="fill" />;
  }

  return <ArrowsClockwiseIcon className={ICON_CLASS_NAME} weight="bold" />;
}

function UpdateStatusBadge({
  state,
  ...props
}: ComponentProps<"button"> & { state: UpdateStatusBadgeState }) {
  return (
    <button
      aria-label={getAriaLabel(state)}
      className={cn(
        "inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-full border px-1.5 text-xs leading-none font-semibold whitespace-nowrap shadow-xs [-webkit-app-region:no-drag]",
        BADGE_META[state.type].className,
      )}
      type="button"
      {...props}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {renderTriggerIcon(state)}
      </span>
      <span>{BADGE_META[state.type].label}</span>
    </button>
  );
}

// A release published moments ago may have no notes yet, so a card that found
// none asks again once this old.
const NOTES_STALE_MS = ms("10 minutes");

function notesQuery(version: string | undefined) {
  return rpcClient.releases.notesFor.queryOptions({
    enabled: version !== undefined,
    input: { version: version ?? "" },
    staleTime: NOTES_STALE_MS,
  });
}

/**
 * What the staged build changes, over the Update pill. Clicking the pill still
 * installs straight away; the card only lets someone see what they are about
 * to get first. The notes are fetched as soon as the pill shows, so the card
 * opens with them.
 */
function toastInstallFailure(cause: unknown) {
  // Settings' update section holds the retry and manual-download recourse.
  toast.error("Couldn't install the update", {
    action: {
      label: "Open Settings",
      onClick: () => {
        openSettings({ tab: "General" });
      },
    },
    cause,
    description: "You can try again whenever you're ready.",
  });
}

function UpdateReadyCard({
  children,
  onRestart,
  version,
}: {
  children: ReactNode;
  onRestart: () => void;
  version: string | undefined;
}) {
  useQuery(notesQuery(version));
  return (
    <HoverCard closeDelay={150} openDelay={300}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="end" className="w-85 p-4">
        <UpdateReadyCardBody onRestart={onRestart} version={version} />
      </HoverCardContent>
    </HoverCard>
  );
}

function UpdateReadyCardBody({
  onRestart,
  version,
}: {
  onRestart: () => void;
  version: string | undefined;
}) {
  // Mounting again on each open refetches notes that have gone stale.
  const { data: notes, isPending } = useQuery(notesQuery(version));
  const appTabs = useAppTabs();
  const now = useNow();
  const asksForPassword = useInstallAsksForPassword();
  const installsUnattended = useInstallsUnattended();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-brand-text">
          <ArrowsClockwiseIcon className="size-4.5" weight="bold" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {version ? `Version ${version} is ready` : "An update is ready"}
          </div>
          {notes && (
            <div className="text-xs text-muted-foreground">
              Released{" "}
              {formatRelativeTime(new Date(notes.publishedAt), now.getTime())}
            </div>
          )}
        </div>
      </div>
      {notes ? (
        <div className="flex flex-col gap-2 text-[13px] leading-5">
          <p>{notes.summary}</p>
          {notes.highlights.length > 0 && (
            <ul className="flex flex-col gap-1.5 text-foreground/80">
              {notes.highlights.map((highlight) => (
                <li className="flex gap-2" key={highlight}>
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
                  {highlight}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        !isPending && (
          <p className="text-[13px] leading-5 text-muted-foreground">
            We couldn't load the notes for this version yet.
          </p>
        )
      )}
      {asksForPassword && (
        <p className="text-xs text-muted-foreground">
          Your computer will ask for your password to install the update.
        </p>
      )}
      {installsUnattended && !asksForPassword && (
        <p className="text-xs text-muted-foreground">
          {APP_NAME} installs this by itself the next time you step away.
        </p>
      )}
      <div className="flex items-center justify-between">
        <Button
          className="px-0 text-brand-text"
          onClick={() => {
            appTabs.open("/release-notes");
          }}
          size="sm"
          variant="link"
        >
          {notes ? "See what's new" : "Release notes"}
        </Button>
        <Button onClick={onRestart} size="sm" variant="brand">
          Restart to update
        </Button>
      </div>
    </div>
  );
}
