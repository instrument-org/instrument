import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { useCloseOnWindowBlur } from "@/client/hooks/use-close-on-window-blur";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type CaptureDevices, type GuestCapture } from "@/shared/browser";
import { APP_NAME } from "@instrument-org/shared";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { MicrophoneSlashIcon } from "@phosphor-icons/react/MicrophoneSlash";
import { VideoCameraIcon } from "@phosphor-icons/react/VideoCamera";
import { VideoCameraSlashIcon } from "@phosphor-icons/react/VideoCameraSlash";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

/** Every tab's page with something to show about the microphone and camera. */
export function usePageCaptures(): readonly GuestCapture[] {
  const { data } = useQuery(
    rpcClient.browser.live.captures.experimental_liveOptions(),
  );
  return data ?? [];
}

/** What a page uses of the two, in the words its popover says them in. */
function devicesWords({ audio, video }: CaptureDevices) {
  return audio && video
    ? "microphone and camera"
    : video
      ? "camera"
      : "microphone";
}

/**
 * The mark a tab carries while its page uses the microphone or camera, in
 * place of its icon: the camera for a page using only that, else the mic.
 */
export function CaptureTabIcon({ using }: { using: CaptureDevices }) {
  const Icon = using.video && !using.audio ? VideoCameraIcon : MicrophoneIcon;
  return (
    <Icon
      aria-label={`Using your ${devicesWords(using)}`}
      className="size-3.5 text-brand-700 dark:text-brand-300"
      weight="fill"
    />
  );
}

/**
 * What a page has of the microphone and camera, at the end of its address
 * field, where a browser says it: what it uses now, with Stop; what it asked
 * for with no click of the person's, with Allow; and which the Mac refused
 * the app, with the way to its switch.
 */
export function PageCaptureMark({ targetId }: { targetId: BrowserTargetId }) {
  const [isOpen, setOpen] = useState(false);
  useCloseOnWindowBlur(isOpen, () => {
    setOpen(false);
  });
  const capture = usePageCaptures().find((page) => page.targetId === targetId);
  const stop = useMutation(rpcClient.browser.stopPageCapture.mutationOptions());
  const allow = useMutation(
    rpcClient.browser.allowPageCapture.mutationOptions(),
  );
  const settings = useMutation(
    rpcClient.features.openPrivacySettings.mutationOptions(),
  );
  if (!capture) {
    return null;
  }
  const { refused, site, system, using } = capture;
  const inUse = using.audio || using.video;
  const shown: CaptureDevices = inUse
    ? using
    : system
      ? { audio: system === "microphone", video: system === "camera" }
      : (refused ?? { audio: false, video: false });
  const MicIcon = inUse ? MicrophoneIcon : MicrophoneSlashIcon;
  const CameraIcon = inUse ? VideoCameraIcon : VideoCameraSlashIcon;
  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <PopoverTrigger
        aria-label={
          inUse
            ? `Using your ${devicesWords(using)}`
            : `Can’t use your ${devicesWords(shown)}`
        }
        className={cn(
          "flex h-5 shrink-0 cursor-default items-center gap-1 rounded-full px-1.5 hover:bg-foreground/8 data-[state=open]:bg-foreground/8",
          inUse
            ? "text-brand-700 dark:text-brand-300"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {shown.audio && <MicIcon className="size-3.5" />}
        {shown.video && <CameraIcon className="size-3.5" />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3 text-sm">
        {inUse ? (
          <>
            <p className="font-medium">
              {site} is using your {devicesWords(using)}.
            </p>
            <div className="mt-3 flex justify-end">
              <Button
                disabled={stop.isPending}
                onClick={() => {
                  stop.mutate({ targetId });
                  setOpen(false);
                }}
                size="sm"
                variant="outline"
              >
                Stop
              </Button>
            </div>
          </>
        ) : system ? (
          <>
            <p className="font-medium">
              {APP_NAME} can’t use your {system}.
            </p>
            <p className="mt-1 text-muted-foreground">
              {/* oxlint-disable-next-line studio/no-os-words -- only macOS reports a refusal here */}
              Turn it on in System Settings, then quit and reopen {APP_NAME}.
            </p>
            <div className="mt-3 flex justify-end">
              <Button
                onClick={() => {
                  settings.mutate({
                    pane: system === "camera" ? "Camera" : "Microphone",
                  });
                  setOpen(false);
                }}
                size="sm"
                variant="outline"
              >
                {/* oxlint-disable-next-line studio/no-os-words -- only macOS reports a refusal here */}
                Open System Settings
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="font-medium">
              {site} asked to use your {devicesWords(shown)}.
            </p>
            <div className="mt-3 flex justify-end">
              <Button
                disabled={allow.isPending}
                onClick={() => {
                  allow.mutate({ targetId });
                  setOpen(false);
                }}
                size="sm"
              >
                Allow
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
