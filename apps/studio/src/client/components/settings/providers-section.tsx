import { settingAnchor } from "@/client/components/settings/settings-index";
import { providerMetadataAtom } from "@/client/atoms/provider-metadata";
import { AddProviderDialog } from "@/client/components/add-provider/dialog";
import { AIProviderEditDialog } from "@/client/components/ai-provider-edit-dialog";
import { ProviderConfigListItem } from "@/client/components/provider-config-list-item";
import { ChatGPTAccountCard } from "@/client/components/settings/chatgpt-account-card";
import { ClaudeAccountCard } from "@/client/components/settings/claude-account-card";
import { InstrumentAccountCard } from "@/client/components/settings/instrument-account-card";
import { Button } from "@/client/components/ui/button";
import { rpcClient } from "@/client/rpc/client";
import { type ClientAIProviderConfig } from "@/shared/schemas/provider";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useState } from "react";

export function ProvidersSection({
  autoOpenAddProvider = false,
}: {
  autoOpenAddProvider?: boolean;
}) {
  const { data: providerConfigs } = useQuery(
    rpcClient.providerConfig.live.list.experimental_liveOptions(),
  );
  const { providerMetadataMap } = useAtomValue(providerMetadataAtom);

  const [showAddProvider, setShowAddProvider] = useState(autoOpenAddProvider);
  const [selectedConfig, setSelectedConfig] =
    useState<ClientAIProviderConfig | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div
        className="flex shrink-0 items-center justify-between"
        {...settingAnchor("add-provider")}
      >
        <h3 className="text-sm font-medium text-muted-foreground">
          AI providers
        </h3>
        <Button
          onClick={() => {
            setShowAddProvider(true);
          }}
        >
          <PlusIcon className="size-4" />
          Add provider
        </Button>
      </div>

      <InstrumentAccountCard />
      <ChatGPTAccountCard />
      <ClaudeAccountCard />

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {providerConfigs?.map((config) => (
          <ProviderConfigListItem
            config={config}
            key={config.id}
            metadata={providerMetadataMap.get(config.type)}
            onConfigure={() => {
              setSelectedConfig(config);
            }}
          />
        ))}
      </div>

      {selectedConfig && (
        <AIProviderEditDialog
          config={selectedConfig}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedConfig(null);
            }
          }}
          onSuccess={() => {
            setSelectedConfig(null);
          }}
          open={Boolean(selectedConfig)}
        />
      )}

      {showAddProvider && (
        <AddProviderDialog
          onOpenChange={(open) => {
            if (!open) {
              setShowAddProvider(false);
            }
          }}
          onSuccess={() => {
            setShowAddProvider(false);
          }}
          open={showAddProvider}
          providers={providerConfigs ?? []}
        />
      )}
    </div>
  );
}
