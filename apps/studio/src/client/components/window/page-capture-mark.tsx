import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/client/components/ui/select";
import { useCloseOnWindowBlur } from "@/client/hooks/use-close-on-window-blur";
import { microphoneNames } from "@/client/lib/dictation-microphone";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type CaptureDevices,
  type GuestCapture,
  type SiteCaptureSetting,
} from "@/shared/browser";
import { APP_NAME } from "@instrument-org/shared";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { MicrophoneSlashIcon } from "@phosphor-icons/react/MicrophoneSlash";
import { PauseIcon } from "@phosphor-icons/react/Pause";
import { VideoCameraIcon } from "@phosphor-icons/react/VideoCamera";
import { VideoCameraSlashIcon } from "@phosphor-icons/react/VideoCameraSlash";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

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
    ? "camera and microphone"
    : video
      ? "camera"
      : "microphone";
}

/**
 * The mark a tab carries while its page uses the microphone or camera, in
 * place of its icon: the camera for a page using only that, else the mic,
 * and grey while paused.
 */
export function CaptureTabIcon({
  paused,
  using,
}: {
  paused: boolean;
  using: CaptureDevices;
}) {
  if (paused) {
    return (
      <PauseIcon
        aria-label={`Paused your ${devicesWords(using)}`}
        className="size-3.5 text-muted-foreground"
        weight="fill"
      />
    );
  }
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
 * field, where a browser says it. The first time a site asks after a click
 * of the person's, the ask opens here by itself, with a picture of them, their
 * mic's level and a menu for each device. Later the mark is where they pause
 * or stop a call, change what the site gets, allow a page that asked with no
 * click, and find the switch the Mac turned off.
 */
export function PageCaptureMark({ targetId }: { targetId: BrowserTargetId }) {
  const [isOpen, setOpen] = useState(false);
  useCloseOnWindowBlur(isOpen, () => {
    setOpen(false);
  });
  const capture = usePageCaptures().find((page) => page.targetId === targetId);
  const answer = useMutation(
    rpcClient.browser.answerPageCapture.mutationOptions(),
  );
  if (!capture) {
    return null;
  }
  const { ask, blocked, paused, refused, system, using } = capture;
  const inUse = using.audio || using.video;
  const shown: CaptureDevices = ask
    ? ask
    : inUse
      ? using
      : system
        ? { audio: system === "microphone", video: system === "camera" }
        : (blocked ?? refused ?? { audio: false, video: false });
  const slashed = !ask && !inUse;
  const MicIcon = slashed ? MicrophoneSlashIcon : MicrophoneIcon;
  const CameraIcon = slashed ? VideoCameraSlashIcon : VideoCameraIcon;
  return (
    <Popover
      onOpenChange={(open) => {
        setOpen(open);
        // Putting the ask away is no, for now: the page is refused this
        // time and asks again on its next try.
        if (!open && ask) {
          answer.mutate({ answer: "dismiss", devices: {}, targetId });
        }
      }}
      open={isOpen || !!ask}
    >
      <PopoverTrigger
        aria-label={
          ask
            ? `Asking to use your ${devicesWords(ask)}`
            : inUse
              ? paused
                ? `Paused your ${devicesWords(using)}`
                : `Using your ${devicesWords(using)}`
              : `Can’t use your ${devicesWords(shown)}`
        }
        className={cn(
          "flex h-5 shrink-0 cursor-default items-center gap-1 rounded-full px-1.5 hover:bg-foreground/8 data-[state=open]:bg-foreground/8",
          inUse && !paused
            ? "text-brand-700 dark:text-brand-300"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {inUse && paused ? (
          <PauseIcon className="size-3.5" weight="fill" />
        ) : (
          <>
            {shown.video && <CameraIcon className="size-3.5" />}
            {shown.audio && <MicIcon className="size-3.5" />}
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-90 p-4 text-sm">
        {ask ? (
          <CaptureAsk
            ask={ask}
            capture={capture}
            onAnswer={(choice, devices) => {
              answer.mutate({ answer: choice, devices, targetId });
            }}
          />
        ) : (
          <CaptureState
            capture={capture}
            onDone={() => {
              setOpen(false);
            }}
            targetId={targetId}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** What the mark's popover says once nothing is being asked. */
function CaptureState({
  capture,
  onDone,
  targetId,
}: {
  capture: GuestCapture;
  onDone: () => void;
  targetId: BrowserTargetId;
}) {
  const { blocked, paused, site, system, using } = capture;
  const inUse = using.audio || using.video;
  const stop = useMutation(rpcClient.browser.stopPageCapture.mutationOptions());
  const pause = useMutation(
    rpcClient.browser.pausePageCapture.mutationOptions(),
  );
  const allow = useMutation(
    rpcClient.browser.allowPageCapture.mutationOptions(),
  );
  const settings = useMutation(
    rpcClient.features.openPrivacySettings.mutationOptions(),
  );
  const reload = useMutation(
    rpcClient.browser.reloadPageForCapture.mutationOptions(),
  );
  if (inUse && paused) {
    return (
      <>
        <p className="font-medium">
          You paused your {devicesWords(using)} on {site}.
        </p>
        <div className="mt-3 flex justify-end">
          <Button
            onClick={() => {
              pause.mutate({ paused: false, targetId });
              onDone();
            }}
            size="sm"
          >
            Resume
          </Button>
        </div>
      </>
    );
  }
  if (inUse) {
    return (
      <>
        <p className="font-medium">
          {site} is using your {devicesWords(using)}.
        </p>
        <SiteSettings capture={capture} targetId={targetId} />
        <div className="mt-3 flex justify-end gap-2">
          <Button
            onClick={() => {
              pause.mutate({ paused: true, targetId });
              onDone();
            }}
            size="sm"
          >
            Pause
          </Button>
          <Button
            disabled={stop.isPending}
            onClick={() => {
              stop.mutate({ targetId });
              onDone();
            }}
            size="sm"
          >
            Stop
          </Button>
        </div>
      </>
    );
  }
  if (system) {
    return (
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
              onDone();
            }}
            size="sm"
          >
            {/* oxlint-disable-next-line studio/no-os-words -- only macOS reports a refusal here */}
            Open System Settings
          </Button>
        </div>
      </>
    );
  }
  if (blocked) {
    return (
      <>
        <p className="font-medium">
          {site} can’t use your {devicesWords(blocked).replace(" and ", " or ")}
          .
        </p>
        <SiteSettings capture={capture} targetId={targetId} />
        <div className="mt-3 flex justify-end">
          <Button
            onClick={() => {
              reload.mutate({ targetId });
              onDone();
            }}
            size="sm"
          >
            Reload
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <p className="font-medium">
        {site} asked to use your{" "}
        {devicesWords(capture.refused ?? { audio: true, video: false })}.
      </p>
      <div className="mt-3 flex justify-end">
        <Button
          disabled={allow.isPending}
          onClick={() => {
            allow.mutate({ targetId });
            onDone();
          }}
          size="sm"
        >
          Allow
        </Button>
      </div>
    </>
  );
}

const SETTING_LABELS: Record<SiteCaptureSetting, string> = {
  allow: "Allow",
  ask: "Ask",
  block: "Never allow",
};

/** A row for each device: what the site gets of it from now on. */
function SiteSettings({
  capture,
  targetId,
}: {
  capture: GuestCapture;
  targetId: BrowserTargetId;
}) {
  const set = useMutation(
    rpcClient.browser.setPageCaptureSetting.mutationOptions(),
  );
  const rows = [
    { Icon: VideoCameraIcon, label: "Camera", type: "video" },
    { Icon: MicrophoneIcon, label: "Microphone", type: "audio" },
  ] as const;
  return (
    <div className="mt-3 space-y-2">
      {rows.map(({ Icon, label, type }) => (
        <div className="flex items-center gap-2.5" key={type}>
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1">{label}</span>
          <Select
            onValueChange={(value) => {
              if (value === "allow" || value === "ask" || value === "block") {
                set.mutate({ setting: value, targetId, type });
              }
            }}
            value={capture.settings[type]}
          >
            <SelectTrigger aria-label={label} className="w-40" size="sm">
              <span className="truncate">
                {SETTING_LABELS[capture.settings[type]]}
              </span>
            </SelectTrigger>
            <SelectContent align="end" position="popper">
              {(["allow", "ask", "block"] as const).map((setting) => (
                <SelectItem key={setting} value={setting}>
                  {SETTING_LABELS[setting]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}

type Picked = { audio?: string | undefined; video?: string | undefined };

/**
 * The first-time ask: the site's question, a live picture from the camera
 * and the mic's level, so the person sees and hears what the site would get,
 * a menu for each device, and the three answers. The preview runs in the
 * window, which asks the system first; a device the system refused says so
 * in its place, with the way to its switch.
 */
function CaptureAsk({
  ask,
  capture,
  onAnswer,
}: {
  ask: CaptureDevices;
  capture: GuestCapture;
  onAnswer: (choice: "always" | "never" | "once", devices: Picked) => void;
}) {
  const [system, setSystem] = useState<
    "camera" | "microphone" | null | undefined
  >(undefined);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [picked, setPicked] = useState<Picked>({});
  const [stream, setStream] = useState<MediaStream | null>(null);
  const settings = useMutation(
    rpcClient.features.openPrivacySettings.mutationOptions(),
  );
  useEffect(() => {
    let live = true;
    void rpcClient.browser.askSystemForCapture
      .call({ audio: ask.audio, video: ask.video })
      .then((refused) => {
        if (live) {
          setSystem(refused);
        }
      });
    return () => {
      live = false;
    };
  }, [ask.audio, ask.video]);
  const wantsVideo = ask.video && system !== "camera";
  const wantsAudio = ask.audio && system !== "microphone";
  useEffect(() => {
    if (system === undefined || (!wantsVideo && !wantsAudio)) {
      return;
    }
    let live = true;
    let opened: MediaStream | null = null;
    const constraint = (id: string | undefined) =>
      id ? { deviceId: { exact: id } } : true;
    navigator.mediaDevices
      .getUserMedia({
        audio: wantsAudio && constraint(picked.audio),
        video: wantsVideo && constraint(picked.video),
      })
      .then(async (next) => {
        if (!live) {
          next.getTracks().forEach((track) => {
            track.stop();
          });
          return;
        }
        opened = next;
        setStream(next);
        const listed = await navigator.mediaDevices.enumerateDevices();
        const all = listed.filter((device) => !ALIASES.has(device.deviceId));
        if (!live) {
          return;
        }
        setDevices(all);
        // The device the site had last, by its name, else the one the
        // system handed the preview.
        setPicked((was) => {
          const idOf = (kind: "audio" | "video") => {
            const saved = capture.devices[kind];
            const track = next.getTracks().find((each) => each.kind === kind);
            return (
              was[kind] ??
              all.find(
                (device) =>
                  device.kind === `${kind}input` && device.label === saved,
              )?.deviceId ??
              realId(listed, track?.getSettings().deviceId)
            );
          };
          const audio = idOf("audio");
          const video = idOf("video");
          return audio === was.audio && video === was.video
            ? was
            : { audio, video };
        });
      })
      .catch(() => undefined);
    return () => {
      live = false;
      opened?.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, [
    system,
    wantsAudio,
    wantsVideo,
    picked.audio,
    picked.video,
    capture.devices,
  ]);
  const labelOf = (id: string | undefined) =>
    devices.find((device) => device.deviceId === id)?.label;
  const answer = (choice: "always" | "never" | "once") => {
    onAnswer(choice, {
      audio: ask.audio ? labelOf(picked.audio) : undefined,
      video: ask.video ? labelOf(picked.video) : undefined,
    });
  };
  return (
    <>
      <p className="mb-3 font-medium">
        Use your {devicesWords(ask)} on {capture.site}?
      </p>
      {ask.video &&
        (system === "camera" ? (
          <div className="grid h-44 place-items-center rounded-lg bg-foreground/5 px-6 text-center text-muted-foreground">
            <div>
              <p>
                {APP_NAME} can’t use your camera. Turn it on in{" "}
                {/* oxlint-disable-next-line studio/no-os-words -- only macOS reports a refusal here */}
                System Settings, then quit and reopen {APP_NAME}.
              </p>
              <Button
                className="mt-2"
                onClick={() => {
                  settings.mutate({ pane: "Camera" });
                }}
                size="sm"
              >
                {/* oxlint-disable-next-line studio/no-os-words -- only macOS reports a refusal here */}
                Open System Settings
              </Button>
            </div>
          </div>
        ) : (
          <>
            <CameraPreview stream={stream} />
            <DeviceMenu
              devices={devices.filter((device) => device.kind === "videoinput")}
              icon={<VideoCameraIcon className="size-4" />}
              label="Camera"
              onPick={(id) => {
                setPicked((was) => ({ ...was, video: id }));
              }}
              picked={picked.video}
            />
          </>
        ))}
      {ask.audio &&
        (system === "microphone" ? (
          <p className="mt-2 text-muted-foreground">
            {APP_NAME} can’t use your microphone. Turn it on in{" "}
            {/* oxlint-disable-next-line studio/no-os-words -- only macOS reports a refusal here */}
            System Settings, then quit and reopen {APP_NAME}.
          </p>
        ) : (
          <DeviceMenu
            devices={devices.filter((device) => device.kind === "audioinput")}
            end={<MicLevel stream={stream} />}
            icon={<MicrophoneIcon className="size-4" />}
            label="Microphone"
            onPick={(id) => {
              setPicked((was) => ({ ...was, audio: id }));
            }}
            picked={picked.audio}
          />
        ))}
      <div className="mt-3 flex flex-col gap-1.5">
        <Button
          onClick={() => {
            answer("always");
          }}
          size="sm"
        >
          Allow while visiting
        </Button>
        <Button
          onClick={() => {
            answer("once");
          }}
          size="sm"
        >
          Allow this time
        </Button>
        <Button
          onClick={() => {
            answer("never");
          }}
          size="sm"
        >
          Never allow
        </Button>
      </div>
    </>
  );
}

/** Chromium's names for whichever device the system calls its default. */
const ALIASES = new Set(["", "communications", "default"]);

/**
 * The device an id names, as the menu lists it: the system's default goes by
 * an alias, which shares its group with the real entry.
 */
function realId(listed: MediaDeviceInfo[], id: string | undefined) {
  const entry = listed.find((device) => device.deviceId === id);
  if (!entry || !ALIASES.has(entry.deviceId)) {
    return id;
  }
  return listed.find(
    (device) =>
      device.kind === entry.kind &&
      device.groupId === entry.groupId &&
      !ALIASES.has(device.deviceId),
  )?.deviceId;
}

/** The camera's live picture, mirrored the way a call shows you to yourself. */
function CameraPreview({ stream }: { stream: MediaStream | null }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) {
      video.current.srcObject = stream;
    }
  }, [stream]);
  return (
    <video
      autoPlay
      className="h-44 w-full -scale-x-100 rounded-lg bg-black object-cover"
      muted
      playsInline
      ref={video}
    />
  );
}

/** A device's menu in the ask, by the names the system gives them. */
function DeviceMenu({
  devices,
  end,
  icon,
  label,
  onPick,
  picked,
}: {
  devices: MediaDeviceInfo[];
  end?: React.ReactNode;
  icon: React.ReactNode;
  label: string;
  onPick: (id: string) => void;
  picked: string | undefined;
}) {
  const names = microphoneNames(devices);
  const name = picked ? names.get(picked) : undefined;
  return (
    <Select onValueChange={onPick} value={picked ?? ""}>
      <SelectTrigger
        aria-label={label}
        className="mt-2 w-full text-muted-foreground"
        size="sm"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-left text-foreground">
          {name || label}
        </span>
        {end}
      </SelectTrigger>
      <SelectContent position="popper">
        {devices.map((device) => (
          <SelectItem key={device.deviceId} value={device.deviceId}>
            {names.get(device.deviceId) || label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const LEVEL_BARS = 10;

/** How loud the mic is, as a row of bars that light from the left. */
function MicLevel({ stream }: { stream: MediaStream | null }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      return;
    }
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) {
        peak = Math.max(peak, Math.abs(sample - 128) / 128);
      }
      setLevel(Math.min(1, peak * 2.5));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      void context.close();
    };
  }, [stream]);
  const lit = Math.round(level * LEVEL_BARS);
  return (
    <span aria-hidden className="flex h-3.5 shrink-0 items-end gap-0.5">
      {Array.from({ length: LEVEL_BARS }, (_, index) => (
        <span
          className={cn(
            "w-0.75 rounded-full",
            index < lit ? "bg-brand-600" : "bg-foreground/12",
          )}
          key={index}
          style={{ height: `${String(5 + (index % 4) * 3)}px` }}
        />
      ))}
    </span>
  );
}
