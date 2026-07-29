import { featuresAtom } from "@/client/atoms/features";
import { Card } from "@/client/components/ui/card";
import { Label } from "@/client/components/ui/label";
import { Switch } from "@/client/components/ui/switch";
import { rpcClient } from "@/client/rpc/client";
import { FEATURE_METADATA, type FeatureName } from "@/shared/features";
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
