import { featuresAtom } from "@/client/atoms/features";
import { Card } from "@/client/components/ui/card";
import { Label } from "@/client/components/ui/label";
import { Switch } from "@/client/components/ui/switch";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { FEATURE_METADATA, type FeatureName } from "@/shared/features";
import { useMutation } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useState } from "react";

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
