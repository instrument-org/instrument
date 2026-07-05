import { openSettings } from "@/client/atoms/settings-modal";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

const PROGRESS_RING_CIRCUMFERENCE = 44;
const NOT_AVAILABLE_BADGE_TIMEOUT_MS = 5000;
const ICON_CLASS_NAME = "size-3.5";
const PROGRESS_ICON_CLASS_NAME = "size-3";

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

export function UpdateStatusIndicator() {
  const { data: updateState } = useQuery(
    rpcClient.updates.live.status.experimental_liveOptions(),
  );
  const [hiddenNotAvailableStatus, setHiddenNotAvailableStatus] =
    useState<unknown>(null);

  const updateInfo =
    updateState && "updateInfo" in updateState ? updateState.updateInfo : null;
  const updateVersion = updateInfo?.version;
  const errorMessage =
    updateState?.type === "error" ? updateState.message : undefined;
  const isManualNotAvailable =
    updateState?.type === "not-available" && updateState.notifyUser;
  const hideNotAvailable = hiddenNotAvailableStatus === updateState;

  useEffect(() => {
    if (!isManualNotAvailable) {
      return;
    }

    const timeout = setTimeout(() => {
      setHiddenNotAvailableStatus(updateState);
    }, NOT_AVAILABLE_BADGE_TIMEOUT_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [isManualNotAvailable, updateState]);

  if (!updateState || !isHeaderStatus(updateState.type)) {
    return null;
  }

  // Silent background polls stay in Settings only; don't put a pill in the
  // toolbar for checks the user didn't run.
  const isSilentBackgroundStatus =
    !updateState.notifyUser && isManualOnlyHeaderStatus(updateState.type);

  const handleClick = () => {
    void (async () => {
      if (updateState.type === "downloaded") {
        const [error] = await safe(rpcClient.preferences.quitAndInstall.call());
        if (!error) {
          return;
        }
        // No Toaster in the main window, so fall through to Settings, which
        // surfaces the failure with retry and manual-download options.
      }

      openSettings({ tab: "General" });
    })();
  };

  const badgeState = getBadgeState({
    errorMessage,
    progress:
      updateState.type === "downloading"
        ? Math.round(updateState.progress.percent)
        : undefined,
    status: updateState.type,
    version: updateVersion,
  });

  if (!badgeState) {
    return null;
  }

  const showBadge =
    !isSilentBackgroundStatus && !(hideNotAvailable && isManualNotAvailable);

  if (!showBadge) {
    return <AnimatePresence initial={false} mode="wait" />;
  }

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        animate={{ opacity: 1, x: 0 }}
        className="inline-flex h-5 items-center"
        exit={{ opacity: 0, x: 6 }}
        initial={{ opacity: 0, x: 10 }}
        key={badgeState.type}
        transition={{ duration: 0.28, ease: "easeOut" }}
      >
        <UpdateStatusBadge onClick={handleClick} state={badgeState} />
      </motion.div>
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

function getStatusCopy(state: UpdateStatusBadgeState) {
  switch (state.type) {
    case "checking": {
      return {
        ariaLabel: "Checking for updates",
        label: "Checking",
      };
    }
    case "downloaded": {
      return {
        ariaLabel: state.version
          ? `Update ${state.version} ready`
          : "Update ready",
        label: "Update",
      };
    }
    case "downloading": {
      return {
        ariaLabel: "Downloading update",
        label: "Updating",
      };
    }
    case "error": {
      return {
        ariaLabel: state.message
          ? `Update failed: ${state.message}`
          : "Update failed",
        label: "Update issue",
      };
    }
    case "installing": {
      return {
        ariaLabel: "Installing update",
        label: "Installing",
      };
    }
    case "not-available": {
      return {
        ariaLabel: "No updates available",
        label: "Up to date",
      };
    }
    default: {
      return {
        ariaLabel: "Update status",
        label: "Update",
      };
    }
  }
}

function getTriggerClassName(status: string) {
  switch (status) {
    case "checking":
    case "downloading":
    case "installing": {
      return "border-black/5 bg-background text-muted-foreground hover:bg-muted dark:border-white/10";
    }
    case "downloaded": {
      return "border-transparent bg-brand-600 text-brand-foreground hover:bg-brand-700";
    }
    case "error": {
      return "border-destructive/25 bg-background text-destructive hover:bg-destructive/10 dark:border-destructive/35 dark:hover:bg-destructive/20";
    }
    case "not-available": {
      return "border-black/5 bg-background text-muted-foreground dark:border-white/10";
    }
    default: {
      return "border-foreground bg-foreground text-background hover:bg-foreground/90";
    }
  }
}

function isHeaderStatus(status: string) {
  return (
    status === "checking" ||
    status === "downloaded" ||
    status === "downloading" ||
    status === "error" ||
    status === "installing" ||
    status === "not-available"
  );
}

function isManualOnlyHeaderStatus(status: string) {
  return (
    status === "checking" || status === "error" || status === "not-available"
  );
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
  const statusCopy = getStatusCopy(state);

  return (
    <button
      aria-label={statusCopy.ariaLabel}
      className={cn(
        "inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-full border px-1.5 text-xs leading-none font-semibold whitespace-nowrap shadow-xs transition-colors [-webkit-app-region:no-drag]",
        getTriggerClassName(state.type),
      )}
      onClick={onClick}
      type="button"
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {renderTriggerIcon(state)}
      </span>
      <span>{statusCopy.label}</span>
    </button>
  );
}
