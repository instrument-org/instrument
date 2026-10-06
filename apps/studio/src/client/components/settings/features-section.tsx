import { featuresAtom } from "@/client/atoms/features";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Label } from "@/client/components/ui/label";
import { Switch } from "@/client/components/ui/switch";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { FEATURE_METADATA, type FeatureName } from "@/shared/features";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";

export function FeaturesSection() {
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
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">Feature flags</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Enable or disable experimental features. Changes take effect
          immediately.
        </p>
      </div>

      <div className="space-y-4">
        {(
          Object.entries(FEATURE_METADATA) as [
            FeatureName,
            (typeof FEATURE_METADATA)[FeatureName],
          ][]
        ).map(([feature, { description, title }]) => (
          <Card
            className="flex items-start justify-between gap-4 p-4"
            key={feature}
          >
            <div className="flex-1 space-y-1">
              <Label className="text-sm font-medium" htmlFor={feature}>
                {title}
              </Label>
              <p className="text-sm text-muted-foreground">{description}</p>
              {feature === "external_browser" &&
                optimisticFeatures.external_browser &&
                isMacOS() && <AppManagementHint />}
              {feature === "computer_use" &&
                optimisticFeatures.computer_use &&
                isMacOS() && <ComputerUsePermissions />}
            </div>
            <Switch
              checked={optimisticFeatures[feature]}
              id={feature}
              onCheckedChange={(checked) => {
                void handleToggle(feature, checked);
              }}
            />
          </Card>
        ))}
      </div>
    </div>
  );
}

const COMPUTER_PERMISSIONS = [
  { key: "accessibility", label: "Accessibility" },
  { key: "screenRecording", label: "Screen Recording" },
] as const;

/**
 * Where Instrument stands on the two grants Computer Use runs under, read
 * again whenever the window regains focus: the user grants them in System
 * Settings, so coming back here is when the answer has changed. Asking shows
 * the system's prompts the first time; once declined, only the pane can
 * change the answer, so each missing grant also links to its pane.
 */
function ComputerUsePermissions() {
  const status = useQuery(rpcClient.features.computerUse.status.queryOptions());
  const { data: windowFocusChanged } = useQuery(
    rpcClient.utils.events.windowFocusChanged.experimental_liveOptions(),
  );
  const refetchStatus = status.refetch;
  useEffect(() => {
    void refetchStatus();
  }, [windowFocusChanged, refetchStatus]);
  const request = useMutation(
    rpcClient.features.computerUse.requestPermissions.mutationOptions({
      onSettled: () => {
        void status.refetch();
      },
    }),
  );
  const openSettings = useMutation(
    rpcClient.features.computerUse.openSettings.mutationOptions(),
  );

  const data = status.data;
  if (!data?.supported) {
    return null;
  }
  const allGranted = data.accessibility && data.screenRecording;

  return (
    <div className="space-y-1.5 pt-1 text-sm text-muted-foreground">
      {COMPUTER_PERMISSIONS.map(({ key, label }) => (
        <p key={key}>
          {label}: {data[key] ? "allowed" : "not allowed"}
          {!data[key] && (
            <>
              {" · "}
              <button
                className="underline underline-offset-2"
                onClick={() => {
                  openSettings.mutate({
                    permission:
                      key === "accessibility"
                        ? "accessibility"
                        : "screen-recording",
                  });
                }}
                type="button"
              >
                Open Privacy &amp; Security
              </button>
            </>
          )}
        </p>
      ))}
      {!allGranted && (
        <Button
          disabled={request.isPending}
          onClick={() => {
            request.mutate(undefined);
          }}
          size="sm"
          variant="outline"
        >
          Ask macOS for access
        </Button>
      )}
    </div>
  );
}

/**
 * macOS asks to let this app manage other apps the first time the agent
 * launches the user's Chrome, and denying it is sticky. There is no API to
 * request that consent or to read it back, so the most we can do is point at
 * the pane where it lives.
 */
function AppManagementHint() {
  const openSettings = useMutation(
    rpcClient.features.openAppManagementSettings.mutationOptions(),
  );

  return (
    <p className="text-sm text-muted-foreground">
      macOS asks for permission to manage apps the first time the agent opens
      your browser. If it never worked, or you dismissed the prompt, grant it
      under{" "}
      <button
        className="underline underline-offset-2"
        onClick={() => {
          openSettings.mutate(undefined);
        }}
        type="button"
      >
        Privacy &amp; Security &rsaquo; App Management
      </button>
      .
    </p>
  );
}
