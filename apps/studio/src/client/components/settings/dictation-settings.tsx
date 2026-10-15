import { settingAnchor } from "@/client/components/settings/settings-index";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Label } from "@/client/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/client/components/ui/select";
import { Switch } from "@/client/components/ui/switch";
import {
  pickableInputs,
  resolveMicrophone,
} from "@/client/lib/dictation-microphone";
import { toast } from "@/client/lib/toast";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  DICTATION_LANGUAGES,
  DictationLanguageSchema,
} from "@/shared/dictation";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

const SYSTEM_DEFAULT = "system-default";
const AUTO_DETECT = "auto-detect";

/** The microphones the system lists right now, kept current as they come and go. */
function useInputDevices() {
  const devices = useQuery({
    queryFn: async () =>
      (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === "audioinput")
        .map(({ deviceId, label }) => ({ deviceId, label })),
    queryKey: ["dictation", "input-devices"],
  });
  const { refetch } = devices;
  useEffect(() => {
    const onChange = () => {
      void refetch();
    };
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", onChange);
    };
  }, [refetch]);
  return devices.data ?? [];
}

/**
 * Dictation's settings: which microphone it records from, which language it
 * listens for, whether it plays sounds, and on a Mac, whether macOS lets the app use the microphone.
 */
export function DictationSettings() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setMicrophone = useMutation(
    rpcClient.dictation.setMicrophone.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change the microphone", { cause: error });
      },
    }),
  );
  const setLanguage = useMutation(
    rpcClient.dictation.setLanguage.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change the language", { cause: error });
      },
    }),
  );

  const setSounds = useMutation(
    rpcClient.dictation.setSounds.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change dictation sounds", { cause: error });
      },
    }),
  );

  const devices = useInputDevices();
  const inputs = pickableInputs(devices);
  const chosen = preferences?.dictationMicrophone;
  const resolved = resolveMicrophone(chosen, devices);
  const microphoneValue = chosen
    ? (resolved.deviceId ?? chosen.deviceId)
    : SYSTEM_DEFAULT;
  const microphoneLabel = chosen
    ? (inputs.find((input) => input.deviceId === resolved.deviceId)?.label ??
      chosen.label)
    : "System default";
  const language = preferences?.dictationLanguage;
  const languageLabel =
    DICTATION_LANGUAGES.find((option) => option.code === language)?.name ??
    "Auto-detect";

  return (
    <Card className="p-4">
      <div className="space-y-5">
        <div
          className="flex items-start justify-between gap-4"
          {...settingAnchor("dictation-microphone")}
        >
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor="dictation-microphone">Microphone</Label>
            <p className="text-xs text-muted-foreground">
              {resolved.missing && chosen
                ? `“${chosen.label}” isn't connected, so dictation uses the system default for now.`
                : "Pick the microphone you dictate into."}
            </p>
          </div>
          <Select
            disabled={setMicrophone.isPending}
            onValueChange={(value) => {
              const input = inputs.find((item) => item.deviceId === value);
              setMicrophone.mutate({ microphone: input });
            }}
            value={microphoneValue}
          >
            <SelectTrigger
              className="max-w-56 min-w-0 bg-card bg-none dark:bg-gray-700"
              id="dictation-microphone"
            >
              <span className="truncate">{microphoneLabel}</span>
            </SelectTrigger>
            <SelectContent align="end" position="popper">
              <SelectItem value={SYSTEM_DEFAULT}>System default</SelectItem>
              {inputs.map((input) => (
                <SelectItem key={input.deviceId} value={input.deviceId}>
                  {input.label || "Microphone"}
                </SelectItem>
              ))}
              {chosen && resolved.missing && (
                <SelectItem disabled value={chosen.deviceId}>
                  {chosen.label} (not connected)
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div
          className="flex items-start justify-between gap-4"
          {...settingAnchor("dictation-language")}
        >
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor="dictation-language">Language</Label>
            <p className="text-xs text-muted-foreground">
              {APP_NAME} can work out which language you're speaking, or you can
              pick one.
            </p>
          </div>
          <Select
            disabled={setLanguage.isPending}
            onValueChange={(value) => {
              const picked = DictationLanguageSchema.safeParse(value);
              setLanguage.mutate({
                language: picked.success ? picked.data : undefined,
              });
            }}
            value={language ?? AUTO_DETECT}
          >
            <SelectTrigger
              className="bg-card bg-none dark:bg-gray-700"
              id="dictation-language"
            >
              {languageLabel}
            </SelectTrigger>
            <SelectContent align="end" position="popper">
              <SelectItem value={AUTO_DETECT}>Auto-detect</SelectItem>
              {DICTATION_LANGUAGES.map((option) => (
                <SelectItem key={option.code} value={option.code}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div
          className="flex items-start justify-between gap-4"
          {...settingAnchor("dictation-sounds")}
        >
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor="dictation-sounds">Sounds</Label>
            <p className="text-xs text-muted-foreground">
              Play a sound when dictation starts and stops.
            </p>
          </div>
          <Switch
            checked={preferences?.dictationSounds ?? true}
            disabled={setSounds.isPending}
            id="dictation-sounds"
            onCheckedChange={(on) => {
              setSounds.mutate({ on });
            }}
          />
        </div>

        {isMacOS() && <MicrophoneAccessRow />}
      </div>
    </Card>
  );
}

/**
 * What macOS says about the app and the microphone, read again whenever the
 * window takes focus, which is when someone comes back from System Settings.
 */
function MicrophoneAccessRow() {
  const access = useQuery(rpcClient.mac.microphone.status.queryOptions());
  const { data: windowFocusChanged } = useQuery(
    rpcClient.utils.events.windowFocusChanged.experimental_liveOptions(),
  );
  const { refetch } = access;
  useEffect(() => {
    void refetch();
  }, [windowFocusChanged, refetch]);
  const openSettings = useMutation(
    rpcClient.mac.microphone.openSettings.mutationOptions(),
  );

  const status = access.data;
  if (status === undefined || status === "unsupported") {
    return null;
  }
  const detail = {
    denied:
      // oxlint-disable-next-line studio/no-os-words -- this row shows only on macOS
      "Microphone access is off in System Settings, so you can't dictate.",
    granted: `${APP_NAME} can use the microphone.`,
    "not-determined": "macOS asks the first time you dictate.",
    restricted:
      // oxlint-disable-next-line studio/no-os-words -- this row shows only on macOS
      "This Mac doesn't allow microphone access, so you can't dictate.",
  }[status];

  return (
    <div
      className="flex items-center justify-between gap-4"
      {...settingAnchor("microphone-access")}
    >
      <div className="min-w-0 space-y-0.5">
        <Label>Microphone access</Label>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <Button
        className="shrink-0"
        disabled={openSettings.isPending}
        onClick={() => {
          openSettings.mutate(undefined);
        }}
        size="sm"
        variant="outline"
      >
        {/* oxlint-disable-next-line studio/no-os-words -- this row shows only on macOS */}
        Open System Settings
      </Button>
    </div>
  );
}
