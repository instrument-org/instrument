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
import { StateArrival } from "@/client/components/state-arrival";
import {
  microphoneName,
  microphoneNames,
  pickableInputs,
  resolveMicrophone,
} from "@/client/lib/dictation-microphone";
import { toast } from "@/client/lib/toast";
import { isMacOS } from "@/client/lib/utils";
import { type RPCOutput } from "@/client/rpc/client";
import { rpcClient } from "@/client/rpc/client";
import {
  DICTATION_LANGUAGES,
  DictationLanguageSchema,
} from "@/shared/dictation";
import { APP_NAME } from "@instrument-org/shared";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

const SYSTEM_DEFAULT = "system-default";
const AUTO_DETECT = "auto-detect";

/**
 * The microphones the system lists right now, kept current as they come and
 * go; undefined until the first list is in.
 */
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
  return devices.data;
}

/**
 * Dictation's settings, or in their place, until the system lets the app use
 * the microphone, one card that asks for it. The microphone list has no
 * names to show before then anyway. The answer is read again whenever the
 * window takes focus, which is when someone comes back from the system's
 * settings, and the settings settle in once it changes.
 */
export function DictationSettings() {
  const access = useQuery(rpcClient.dictation.access.status.queryOptions());
  const { data: windowFocusChanged } = useQuery(
    rpcClient.utils.events.windowFocusChanged.experimental_liveOptions(),
  );
  const { refetch } = access;
  useEffect(() => {
    void refetch();
  }, [windowFocusChanged, refetch]);
  const status = access.data;
  const gate =
    status === "not-determined" ||
    status === "denied" ||
    status === "restricted" ||
    status === "reopen"
      ? status
      : undefined;
  return (
    <StateArrival
      state={status === undefined ? undefined : (gate ?? "allowed")}
    >
      {gate ? (
        <MicrophoneAccessCard
          onAnswered={() => {
            void refetch();
          }}
          state={gate}
        />
      ) : (
        <DictationChoices />
      )}
    </StateArrival>
  );
}

/** Which microphone dictation records from, which language it listens for, and its sounds. */
function DictationChoices() {
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
  const inputs = pickableInputs(devices ?? []);
  const names = microphoneNames(inputs);
  const chosen = preferences?.dictationMicrophone;
  // Until the system lists its devices, the one picked is taken as there, so
  // opening Settings doesn't flash it as disconnected.
  const resolved = devices
    ? resolveMicrophone(chosen, devices)
    : { deviceId: chosen?.deviceId, missing: false };
  const microphoneValue = chosen
    ? (resolved.deviceId ?? chosen.deviceId)
    : SYSTEM_DEFAULT;
  const microphoneLabel = chosen
    ? (resolved.deviceId && names.get(resolved.deviceId)) ||
      microphoneName(chosen.label)
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
                ? `“${microphoneName(chosen.label)}” isn't connected, so dictation uses the system default for now.`
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
                  {names.get(input.deviceId) || "Microphone"}
                </SelectItem>
              ))}
              {chosen && resolved.missing && (
                <SelectItem disabled value={chosen.deviceId}>
                  {microphoneName(chosen.label)} (not connected)
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
      </div>
    </Card>
  );
}

/**
 * Where the system stands on the microphone, and the one thing to do about
 * it: allow it, turn it on in the system's settings, or reopen so macOS's
 * new answer reaches the app.
 */
function MicrophoneAccessCard({
  onAnswered,
  state,
}: {
  onAnswered: () => void;
  state: Exclude<
    RPCOutput["dictation"]["access"]["status"],
    "granted" | "unsupported"
  >;
}) {
  const request = useMutation(
    rpcClient.dictation.access.request.mutationOptions({
      onSettled: onAnswered,
    }),
  );
  const openSettings = useMutation(
    rpcClient.dictation.access.openSettings.mutationOptions(),
  );
  const reopen = useMutation(
    rpcClient.dictation.access.reopen.mutationOptions(),
  );
  const mac = isMacOS();
  const detail = {
    denied: mac
      ? // oxlint-disable-next-line studio/no-os-words -- only on macOS
        "Turned off in System Settings."
      : // oxlint-disable-next-line studio/no-os-words -- only on Windows
        "Turned off in Windows privacy settings.",
    "not-determined": "Needed for dictation.",
    reopen: `Reopen ${APP_NAME} to start using it.`,
    // oxlint-disable-next-line studio/no-os-words -- macOS alone restricts it
    restricted: "This Mac doesn't allow it.",
  }[state];
  const openSettingsButton = (
    <Button
      className="shrink-0 rounded-full px-5"
      disabled={openSettings.isPending}
      onClick={() => {
        openSettings.mutate(undefined);
      }}
      size="sm"
      variant="outline"
    >
      {mac
        ? // oxlint-disable-next-line studio/no-os-words -- only on macOS
          "Open System Settings"
        : "Open settings"}
    </Button>
  );
  return (
    <Card className="p-4">
      <div
        className="flex items-center gap-3.5"
        {...settingAnchor("microphone-access")}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-brand-600 text-white">
          <MicrophoneIcon className="size-5" weight="fill" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-medium">Microphone access</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
        {state === "not-determined" && (
          <Button
            className="shrink-0 rounded-full px-5"
            disabled={request.isPending}
            onClick={() => {
              request.mutate(undefined);
            }}
            size="sm"
            variant="brand"
          >
            Allow
          </Button>
        )}
        {state === "denied" && openSettingsButton}
        {state === "reopen" && (
          <div className="flex shrink-0 items-center gap-2">
            {openSettingsButton}
            <Button
              className="shrink-0 rounded-full px-5"
              disabled={reopen.isPending}
              onClick={() => {
                reopen.mutate(undefined);
              }}
              size="sm"
              variant="brand"
            >
              Reopen
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
