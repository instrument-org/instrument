import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { Button } from "@/client/components/ui/button";
import { DropdownMenuItem } from "@/client/components/ui/dropdown-menu";
import {
  ProviderMoreMenu,
  DISABLED_LINE,
  DisableItem,
} from "@/client/components/settings/provider-switch";
import { settingAnchor } from "@/client/components/settings/settings-index";
import { Card } from "@/client/components/ui/card";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ClientAIProviderConfig } from "@/shared/schemas/provider";
import { type ProviderMetadata } from "@instrument-org/ai-gateway/client";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { AIProviderIcon } from "./ai-provider-icon";

const formatCredits = (credits: number) => {
  return credits.toFixed(2);
};

/** The server a custom provider points at, without the path that follows. */
const hostOf = (url: string) => URL.parse(url)?.host ?? url;

export function ProviderConfigListItem({
  className,
  config,
  metadata,
  off = false,
  onConfigure,
  onSetEnabled,
}: {
  className?: string;
  config: ClientAIProviderConfig;
  metadata?: ProviderMetadata;
  /** Disabled: grayed, saying so, with Enable beside Manage. */
  off?: boolean;
  onConfigure: () => void;
  onSetEnabled: (enabled: boolean) => void;
}) {
  const { data: openRouterCredits, isLoading: isLoadingCredits } = useQuery({
    ...rpcClient.providerConfig.credits.queryOptions({
      input: { id: config.id },
    }),
    // Only OpenRouter supports credit querying right now
    enabled: config.type === "openrouter" && !off,
    refetchInterval: 30_000,
  });

  const remove = useMutation(rpcClient.providerConfig.remove.mutationOptions());
  // Removing forgets the key, so it asks first.
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const displayName = config.displayName || metadata?.name;
  const label = displayName ?? "this provider";
  const originalName = metadata?.name;
  const showOriginalName =
    config.displayName && originalName && config.displayName !== originalName;

  return (
    <Card className={cn("gap-0 p-4", className)}>
      <div
        className="flex items-start justify-between"
        {...settingAnchor(`provider:${config.id}`)}
      >
        <div
          className={cn(
            "flex min-w-0 flex-1 items-start gap-3",
            off && "opacity-50 grayscale",
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center">
            <AIProviderIcon type={config.type} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="truncate font-medium text-foreground">
              {displayName}
            </h3>
            {showOriginalName && (
              <p className="truncate text-sm text-muted-foreground">
                {originalName}
              </p>
            )}
            {off ? (
              <p className="text-sm text-muted-foreground">{DISABLED_LINE}</p>
            ) : config.type === "openai-compatible" && config.baseURL ? (
              <p className="truncate text-sm text-muted-foreground">
                {hostOf(config.baseURL)}
              </p>
            ) : (
              <p className="truncate text-sm text-muted-foreground">
                {metadata?.description ?? "Metadata not found"}
              </p>
            )}
            {config.type === "openrouter" && !off && (
              <p className="truncate text-sm text-muted-foreground">
                {isLoadingCredits
                  ? "Loading credits..."
                  : openRouterCredits?.credits
                    ? `$${formatCredits(openRouterCredits.credits.remaining)} remaining`
                    : "Unable to load credits"}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {off && (
            <Button
              onClick={() => {
                onSetEnabled(true);
              }}
              variant="outline"
            >
              Enable
            </Button>
          )}
          <Button onClick={onConfigure} variant={off ? "ghost" : "outline"}>
            Manage
          </Button>
          <ProviderMoreMenu label={label}>
            {!off && (
              <DisableItem
                onSelect={() => {
                  onSetEnabled(false);
                }}
              />
            )}
            <DropdownMenuItem
              onSelect={() => {
                setConfirmingRemove(true);
              }}
              variant="destructive"
            >
              Remove…
            </DropdownMenuItem>
          </ProviderMoreMenu>
        </div>
      </div>
      <AlertDialog onOpenChange={setConfirmingRemove} open={confirmingRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {APP_NAME} forgets its key, and chats on its models will need a
              different model. You can add it again any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                remove.mutate(
                  { id: config.id },
                  {
                    onError: (error) => {
                      toast.error(`Couldn't remove ${label}`, {
                        cause: error,
                      });
                    },
                  },
                );
              }}
              variant="destructive"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
