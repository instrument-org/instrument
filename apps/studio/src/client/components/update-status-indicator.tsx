import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { ArrowsClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

const PROGRESS_RING_CIRCUMFERENCE = 44;
const ICON_CLASS_NAME = "size-3.5";
const PROGRESS_ICON_CLASS_NAME = "size-3";

export function UpdateStatusIndicator() {
  const { data: updateState } = useQuery(
    rpcClient.updates.live.status.experimental_liveOptions(),
  );

  const updateInfo =
    updateState && "updateInfo" in updateState ? updateState.updateInfo : null;
  const updateVersion = updateInfo?.version;
  const errorMessage =
    updateState?.type === "error" ? updateState.message : undefined;

  if (!updateState || !isHeaderStatus(updateState.type)) {
    return null;
  }

  const progress =
    updateState.type === "downloading"
      ? Math.round(updateState.progress.percent)
      : null;
  const statusCopy = getStatusCopy({
    errorMessage,
    status: updateState.type,
    version: updateVersion,
  });

  const handleClick = () => {
    if (updateState.type === "downloaded") {
      void rpcClient.preferences.quitAndInstall.call();
      return;
    }

    void rpcClient.studioOverlay.show.call({
      kind: "settings",
      props: { tab: "General" },
    });
  };

  return (
    <button
      aria-label={statusCopy.ariaLabel}
      className={cn(
        "inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-full border px-1.5 text-xs leading-none font-semibold whitespace-nowrap shadow-xs transition-colors [-webkit-app-region:no-drag]",
        getTriggerClassName(updateState.type),
      )}
      onClick={handleClick}
      type="button"
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {renderTriggerIcon({ progress, status: updateState.type })}
      </span>
      <span>{statusCopy.label}</span>
    </button>
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

function getStatusCopy({
  errorMessage,
  status,
  version,
}: {
  errorMessage: string | undefined;
  status: string;
  version: string | undefined;
}) {
  switch (status) {
    case "downloaded": {
      return {
        ariaLabel: version ? `Update ${version} ready` : "Update ready",
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
        ariaLabel: errorMessage
          ? `Update failed: ${errorMessage}`
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
    case "downloaded": {
      return "border-brand-700 bg-brand-600 text-brand-foreground hover:bg-brand-700";
    }
    case "downloading":
    case "installing": {
      return "border-black/5 bg-background text-muted-foreground hover:bg-muted dark:border-white/10";
    }
    case "error": {
      return "border-destructive/25 bg-background text-destructive hover:bg-destructive/10 dark:border-destructive/35 dark:hover:bg-destructive/20";
    }
    default: {
      return "border-foreground bg-foreground text-background hover:bg-foreground/90";
    }
  }
}

function isHeaderStatus(status: string) {
  return (
    status === "downloaded" ||
    status === "downloading" ||
    status === "error" ||
    status === "installing"
  );
}

function renderTriggerIcon({
  progress,
  status,
}: {
  progress: null | number;
  status: string;
}) {
  if (status === "downloading") {
    return (
      <CircularProgressIcon
        progress={progress ?? 0}
        sizeClassName={PROGRESS_ICON_CLASS_NAME}
      />
    );
  }

  if (status === "installing") {
    return <Spinner className="size-3" />;
  }

  if (status === "error") {
    return <WarningCircleIcon className={ICON_CLASS_NAME} weight="fill" />;
  }

  return <ArrowsClockwiseIcon className={ICON_CLASS_NAME} weight="bold" />;
}
