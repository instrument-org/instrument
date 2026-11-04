import { featuresAtom } from "@/client/atoms/features";
import { DebugSection } from "@/client/components/settings/debug-section";
import { SettingsSection } from "@/client/components/settings/general-section";
import { settingAnchor } from "@/client/components/settings/settings-index";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/client/components/ui/select";
import { Switch } from "@/client/components/ui/switch";
import { toast } from "@/client/lib/toast";
import { isLinux } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { FEATURE_METADATA, type FeatureName } from "@/shared/features";
import {
  namedPlatformApiServerLabel,
  namedPlatformApiServerOf,
  offersAnyPlatformApiServer,
  PlatformApiServerSchema,
} from "@/shared/platform-api-server";
import { APP_FLAVOR, APP_NAME } from "@instrument-org/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useState } from "react";

/** The settings only a developer reaches for, in the one tab developer mode adds. */
export function DeveloperSection() {
  return (
    <div className="space-y-6">
      <PlatformApiServerSetting />
      <ReleaseChannel />
      <FeatureFlags />
      {isLinux() && (
        <SettingsSection title="Secure storage">
          <DebugSection />
        </SettingsSection>
      )}
    </div>
  );
}

const RELEASE_CHANNELS = [
  { label: "Stable", value: "latest" },
  { label: "Beta", value: "beta" },
] as const;

/**
 * Which builds this computer updates to. The beta feed is for the people
 * testing a release before it ships.
 */
function ReleaseChannel() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setReleaseChannelMutation = useMutation(
    rpcClient.preferences.setReleaseChannel.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change the release channel", { cause: error });
      },
    }),
  );

  const channel = preferences?.releaseChannel ?? "latest";
  const triggerLabel =
    RELEASE_CHANNELS.find((option) => option.value === channel)?.label ??
    channel;

  return (
    <SettingsSection title="Release channel">
      <Card className="p-4">
        <div
          className="flex items-start justify-between gap-4"
          {...settingAnchor("release-channel")}
        >
          <div className="space-y-1">
            <Label htmlFor="release-channel">Channel</Label>
            <p className="text-xs text-muted-foreground">
              Beta gets each new version as soon as it’s out. Switching back to
              Stable keeps this version until a newer stable one ships.
            </p>
          </div>
          <Select
            disabled={setReleaseChannelMutation.isPending}
            onValueChange={(value) => {
              const option = RELEASE_CHANNELS.find((o) => o.value === value);
              if (option) {
                setReleaseChannelMutation.mutate({
                  channel: option.value === "latest" ? undefined : option.value,
                });
              }
            }}
            value={channel}
          >
            <SelectTrigger
              className="bg-card bg-none dark:bg-gray-700"
              id="release-channel"
            >
              {triggerLabel}
            </SelectTrigger>
            <SelectContent align="end" position="popper">
              {RELEASE_CHANNELS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>
    </SettingsSection>
  );
}

type ServerOption = "custom" | "local" | "production" | "staging";

const SERVER_OPTIONS: readonly { label: string; value: ServerOption }[] =
  offersAnyPlatformApiServer(APP_FLAVOR)
    ? [
        {
          label: namedPlatformApiServerLabel("production"),
          value: "production",
        },
        { label: namedPlatformApiServerLabel("staging"), value: "staging" },
        { label: namedPlatformApiServerLabel("local"), value: "local" },
        { label: "Custom", value: "custom" },
      ]
    : [
        {
          label: namedPlatformApiServerLabel("production"),
          value: "production",
        },
        { label: namedPlatformApiServerLabel("staging"), value: "staging" },
      ];

/**
 * Which platform API server this computer talks to: staging, and in a
 * development build a local or typed-in server, are for the people working on
 * the API. A change restarts the app, after asking here.
 */
function PlatformApiServerSetting() {
  const { data: current } = useQuery(
    rpcClient.preferences.platformApiServer.queryOptions(),
  );
  const [picked, setPicked] = useState<null | ServerOption>(null);
  const [customUrl, setCustomUrl] = useState("");
  const setServerMutation = useMutation(
    rpcClient.preferences.setPlatformApiServer.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't switch servers", { cause: error });
      },
      onSuccess: ({ outcome }) => {
        if (outcome === "unsupported") {
          toast.info(`Quit ${APP_NAME} and open it again to use that server.`);
        }
        if (outcome !== "relaunching") {
          setPicked(null);
        }
      },
    }),
  );

  if (current === undefined) {
    return null;
  }

  const currentOption: ServerOption =
    namedPlatformApiServerOf(current.baseUrl) ?? "custom";
  const shown = picked ?? currentOption;
  const triggerLabel =
    SERVER_OPTIONS.find((option) => option.value === shown)?.label ?? "Custom";
  const custom = PlatformApiServerSchema.safeParse({
    custom: customUrl.trim(),
  });
  const server =
    picked === "custom"
      ? custom.success
        ? custom.data
        : undefined
      : (picked ?? undefined);
  const pickedLabel =
    picked === "custom"
      ? (URL.parse(customUrl.trim())?.host ?? "that server")
      : SERVER_OPTIONS.find((option) => option.value === picked)?.label;

  return (
    <SettingsSection title="API server">
      <Card className="p-4">
        <div className="space-y-3" {...settingAnchor("api-server")}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="api-server">Server</Label>
              <p className="text-xs text-muted-foreground">
                Sign-in, plans, and {APP_NAME} models all use this server.
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {current.baseUrl}
              </p>
            </div>
            <Select
              disabled={setServerMutation.isPending}
              onValueChange={(value) => {
                const option = SERVER_OPTIONS.find((o) => o.value === value);
                if (!option) {
                  return;
                }
                if (
                  option.value === currentOption &&
                  option.value !== "custom"
                ) {
                  setPicked(null);
                  return;
                }
                if (option.value === "custom" && currentOption === "custom") {
                  setCustomUrl(current.baseUrl);
                }
                setPicked(option.value);
              }}
              value={shown}
            >
              <SelectTrigger
                className="bg-card bg-none dark:bg-gray-700"
                id="api-server"
              >
                {triggerLabel}
              </SelectTrigger>
              <SelectContent align="end" position="popper">
                {SERVER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {picked !== null && (
            <div className="space-y-2 border-t pt-3">
              {picked === "custom" && (
                <Input
                  aria-invalid={customUrl.trim() !== "" && !custom.success}
                  aria-label="Server address"
                  autoFocus
                  className="font-mono text-xs"
                  onChange={(event) => setCustomUrl(event.target.value)}
                  placeholder="http://localhost:49100"
                  value={customUrl}
                />
              )}
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  {APP_NAME} will restart to use {pickedLabel}. You stay signed
                  in on each server you’ve used.
                </p>
                <div className="flex shrink-0 gap-2">
                  <Button
                    disabled={setServerMutation.isPending}
                    onClick={() => setPicked(null)}
                    size="sm"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={
                      server === undefined || setServerMutation.isPending
                    }
                    onClick={() => {
                      if (server !== undefined) {
                        setServerMutation.mutate({ server });
                      }
                    }}
                    size="sm"
                  >
                    Restart
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
    </SettingsSection>
  );
}

/** One row per flag, its description a line under its name. */
function FeatureFlags() {
  const features = useAtomValue(featuresAtom);
  const [optimisticFeatures, setOptimisticFeatures] =
    useState<Record<FeatureName, boolean>>(features);
  const [lastFeatures, setLastFeatures] =
    useState<Record<FeatureName, boolean>>(features);

  if (features !== lastFeatures) {
    setLastFeatures(features);
    setOptimisticFeatures(features);
  }

  const handleToggle = async (feature: FeatureName, enabled: boolean) => {
    setOptimisticFeatures((prev) => ({ ...prev, [feature]: enabled }));

    try {
      await rpcClient.features.setEnabled.call({ enabled, feature });
    } catch {
      setOptimisticFeatures(features);
    }
  };

  return (
    <SettingsSection title="Feature flags">
      <Card className="gap-0 divide-y p-0">
        {(
          Object.entries(FEATURE_METADATA) as [
            FeatureName,
            (typeof FEATURE_METADATA)[FeatureName],
          ][]
        ).map(([feature, { description, title }]) => (
          <div
            className="flex items-center justify-between gap-4 px-4 py-2.5"
            key={feature}
            {...settingAnchor(`feature:${feature}`)}
          >
            <div className="min-w-0 flex-1">
              <Label className="text-sm font-medium" htmlFor={feature}>
                {title}
              </Label>
              <p
                className="truncate text-xs text-muted-foreground"
                title={description}
              >
                {description}
              </p>
            </div>
            <Switch
              checked={optimisticFeatures[feature]}
              id={feature}
              onCheckedChange={(checked) => {
                void handleToggle(feature, checked);
              }}
            />
          </div>
        ))}
      </Card>
    </SettingsSection>
  );
}
