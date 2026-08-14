import { openSettings } from "@/client/atoms/settings-modal";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/ArrowsClockwise";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
  downloading: {
    className: MUTED_TRIGGER_CLASS_NAME,
    label: "Updating",
    manualOnly: false,
  },
  error: {
    className:
      "border-destructive/25 bg-background text-destructive hover:bg-destructive/10 dark:border-destructive/35 dark:hover:bg-destructive/20",
    label: "Update issue",
    manualOnly: true,
  },
  installing: {
    className: MUTED_TRIGGER_CLASS_NAME,
    label: "Installing",
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
        const [error, result] = await safe(
          rpcClient.preferences.quitAndInstall.call(),
        );
        if (error) {
          // Settings' update section holds the retry and manual-download recourse.
          toast.error("Couldn't install the update", {
            action: {
              label: "Open Settings",
              onClick: () => {
                openSettings({ tab: "General" });
              },
            },
            description: error.message,
          });
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
  const visibleBadge =
    updateState &&
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
          <UpdateStatusBadge onClick={handleClick} state={visibleBadge} />
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
      return "Installing update";
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
    return <Spinner className="size-3" />;
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
    return <Spinner className="size-3" />;
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
  onClick,
  state,
}: {
  onClick: () => void;
  state: UpdateStatusBadgeState;
}) {
  return (
    <button
      aria-label={getAriaLabel(state)}
      className={cn(
        "inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-full border px-1.5 text-xs leading-none font-semibold whitespace-nowrap shadow-xs [-webkit-app-region:no-drag]",
        BADGE_META[state.type].className,
      )}
      onClick={onClick}
      type="button"
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {renderTriggerIcon(state)}
      </span>
      <span>{BADGE_META[state.type].label}</span>
    </button>
  );
}
