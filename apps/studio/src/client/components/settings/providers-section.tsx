import { openLogin } from "@/client/atoms/login-modal";
import { providerMetadataAtom } from "@/client/atoms/provider-metadata";
import { AddProviderDialog } from "@/client/components/add-provider/dialog";
import { AIProviderEditDialog } from "@/client/components/ai-provider-edit-dialog";
import { BrandLeafIcon } from "@/client/components/icons/brand-leaf";
import { ProviderConfigListItem } from "@/client/components/provider-config-list-item";
import { Button } from "@/client/components/ui/button";
import { rpcClient } from "@/client/rpc/client";
import { type ClientAIProviderConfig } from "@/shared/schemas/provider";
import { CpuIcon, PlusIcon } from "@phosphor-icons/react";
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
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const { providerMetadataMap } = useAtomValue(providerMetadataAtom);

  const [showAddProvider, setShowAddProvider] = useState(autoOpenAddProvider);
  const [selectedConfig, setSelectedConfig] =
    useState<ClientAIProviderConfig | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex shrink-0 items-center justify-between">
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

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {providerConfigs?.length === 0 ? (
          <div
            className="relative flex flex-1 flex-col items-center justify-center
              overflow-hidden rounded-xl border border-black/5 dark:border-white/5"
          >
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-xl bg-black/5 p-2 dark:bg-white/5">
                <CpuIcon className="size-4 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                No providers configured yet
              </p>
            </div>

            {!hasToken && (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 flex h-48
                  items-end justify-center bg-linear-to-t from-brand-500/5
                  to-transparent dark:from-brand-500/5"
              >
                <div className="pointer-events-auto flex items-center gap-4 pb-4">
                  <div className="flex items-center gap-2">
                    <BrandLeafIcon className="size-3" />
                    <span className="text-xs font-medium text-brand-600 dark:text-brand-400">
                      Log in to enjoy free AI usage without a provider
                    </span>
                  </div>
                  <Button
                    onClick={() => {
                      openLogin({ hideManualProvider: true });
                    }}
                    size="sm"
                  >
                    Log in
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          providerConfigs?.map((config) => (
            <ProviderConfigListItem
              config={config}
              key={config.id}
              metadata={providerMetadataMap.get(config.type)}
              onConfigure={() => {
                setSelectedConfig(config);
              }}
            />
          ))
        )}
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
