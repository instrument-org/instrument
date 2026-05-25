import { AppIconGlyph } from "@/client/components/studio-icon";
import { Button } from "@/client/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Switch } from "@/client/components/ui/switch";
import { useHasPremium } from "@/client/hooks/use-entitlements";
import {
  getGroupedModelsEntries,
  groupAndFilterModels,
} from "@/client/lib/group-models";
import { joinFuzzyFields } from "@/client/lib/join-fuzzy-fields";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  type AIGatewayModel,
  type AIGatewayModelURI,
} from "@instrument-org/ai-gateway/client";
import { APP_NAME, OUR_MODELS } from "@instrument-org/shared";
import uFuzzy from "@leeoniya/ufuzzy";
import {
  CaretDownIcon,
  CheckIcon,
  PlusIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const fuzzy = new uFuzzy({ intraMode: 1 });

import { AIProviderIcon } from "./ai-provider-icon";
import { FuzzyHighlight } from "./fuzzy-highlight";
import { ModelBadges } from "./model-badges";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface MatchedModel {
  model: AIGatewayModel.Type;
  nameRanges: null | number[];
  providerRanges: null | number[];
}

interface ModelPickerProps {
  className?: string;
  disabled?: boolean;
  errors?: RPCOutput["gateway"]["models"]["list"]["errors"];
  isError?: boolean;
  isInvalidOurModel?: boolean;
  isLoading?: boolean;
  models?: AIGatewayModel.Type[];
  onAddProvider?: () => void;
  onOpenChange?: (open: boolean) => void;
  onValueChange: (value: AIGatewayModelURI.Type) => void;
  placeholder?: string;
  selectedModel?: AIGatewayModel.Type;
}

type VirtualRow =
  | { groupName: string; type: "header" }
  | { matched: MatchedModel; requiresPremium: boolean; type: "item" };

export function ModelPicker({
  className = "",
  disabled = false,
  errors,
  isError = false,
  isInvalidOurModel = false,
  isLoading = false,
  models,
  onAddProvider,
  onOpenChange,
  onValueChange,
  placeholder = "Select a model",
  selectedModel,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const closePopover = () => {
    setOpen(false);
    setSearchQuery("");
  };
  const navigate = useNavigate();
  const hasPremium = useHasPremium();

  const autoModel = models?.find((m) => m.providerId === OUR_MODELS.text.id);
  const modelsWithoutAuto = useMemo(
    () => models?.filter((m) => m.providerId !== OUR_MODELS.text.id) ?? [],
    [models],
  );
  const groupedModels = useMemo(
    () => groupAndFilterModels({ hasPremium, models: modelsWithoutAuto }),
    [modelsWithoutAuto, hasPremium],
  );

  type GroupedMatchedModels = Record<string, MatchedModel[]>;

  const filteredGroupedModels = useMemo((): GroupedMatchedModels => {
    const entries = getGroupedModelsEntries(groupedModels);
    const result: GroupedMatchedModels = {};

    for (const [groupName, modelGroup] of entries) {
      if (!searchQuery) {
        result[groupName] = modelGroup.map((model) => ({
          model,
          nameRanges: null,
          providerRanges: null,
        }));
        continue;
      }

      const joined = modelGroup.map((m) =>
        joinFuzzyFields([m.providerName, m.name]),
      );
      const haystack = joined.map((j) => j.haystack);
      // eslint-disable-next-line unicorn/no-array-method-this-argument
      const indexes = fuzzy.filter(haystack, searchQuery);

      if (!indexes || indexes.length === 0) {
        result[groupName] = [];
        continue;
      }

      const info = fuzzy.info(indexes, haystack, searchQuery);
      const order = fuzzy.sort(info, haystack, searchQuery);

      result[groupName] = order.flatMap((orderIdx) => {
        const modelIdx = info.idx[orderIdx] ?? -1;
        const model = modelGroup[modelIdx];
        const fields = joined[modelIdx];
        if (!model || !fields) {
          return [];
        }
        const [providerRanges, nameRanges] = fields.splitRanges(
          info.ranges[orderIdx] ?? null,
        );
        return [
          {
            model,
            nameRanges: nameRanges ?? null,
            providerRanges: providerRanges ?? null,
          },
        ];
      });
    }

    return result;
  }, [groupedModels, searchQuery]);

  const hasModels = modelsWithoutAuto.length > 0;
  const hasErrors = !!errors?.length;
  const isSelectDisabled = disabled || isLoading || isError;
  const hasOurProviderError =
    errors?.some((error) => error.config.type === OUR_MODELS.providerType) ??
    false;

  const isAutoMode = selectedModel?.providerId === OUR_MODELS.text.id;

  const hideModelList = isAutoMode && !searchQuery;

  const placeholderText = isLoading
    ? "Loading models..."
    : isError
      ? "Failed to load models"
      : hasModels
        ? placeholder
        : "No models available";

  return (
    <Popover
      onOpenChange={(newOpen) => {
        if (newOpen) {
          setOpen(true);
        } else {
          closePopover();
        }
        onOpenChange?.(newOpen);
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          className={cn(
            "flex h-auto items-center justify-between gap-2 rounded-lg px-1.5! py-1 text-left",
            !selectedModel && "text-muted-foreground",
            isAutoMode && "text-brand-400 hover:text-brand-400",
            "max-w-full",
            className,
          )}
          disabled={isSelectDisabled}
          role="combobox"
          size="sm"
          variant="ghost"
        >
          <div className="flex w-full min-w-0 items-center">
            {selectedModel ? (
              <div
                className={cn(
                  "flex min-w-0 items-center gap-2 text-xs leading-4 font-medium",
                  isAutoMode ? "text-brand-400" : "text-foreground",
                )}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="shrink-0">
                      {isInvalidOurModel ? (
                        <WarningIcon className="size-4 text-destructive" />
                      ) : (
                        <AIProviderIcon
                          className="size-4 opacity-90"
                          type={selectedModel.params.provider}
                        />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isInvalidOurModel ? (
                      <p>Model requires a paid plan.</p>
                    ) : (
                      <p>{selectedModel.providerName}</p>
                    )}
                  </TooltipContent>
                </Tooltip>
                <span className="min-w-0 flex-1 truncate">
                  {selectedModel.name}
                </span>
              </div>
            ) : (
              placeholderText
            )}
          </div>
          <CaretDownIcon
            className={cn(
              "size-3 shrink-0 opacity-70",
              isAutoMode && "text-brand-400 opacity-100",
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command shouldFilter={false}>
          <AutoModeSwitch
            autoModel={autoModel}
            checked={isAutoMode}
            isInvalidOurModel={isInvalidOurModel}
            onCheckedChange={(checked) => {
              if (checked && autoModel) {
                onValueChange(autoModel.uri);
              } else {
                onValueChange("" as AIGatewayModelURI.Type);
              }
            }}
          />
          {autoModel && <hr className="border-t" />}
          {hasModels && (
            <CommandInput
              autoFocus
              className="h-9"
              containerClassName={cn(isAutoMode && "border-b-0")}
              onValueChange={setSearchQuery}
              placeholder="Search models..."
              value={searchQuery}
            />
          )}
          <CommandList
            className={cn(
              "max-h-none! overflow-visible!",
              hideModelList && "hidden",
            )}
          >
            {hasErrors && (
              <ErrorsGroup
                errors={errors}
                hasOurProviderError={hasOurProviderError}
              />
            )}
            {hasModels ? null : (
              <NoProvidersMessage
                onAddProvider={() => {
                  closePopover();
                  onAddProvider?.();
                }}
              />
            )}
            {isError && (
              <CommandGroup>
                <CommandItem disabled>Failed to load models</CommandItem>
              </CommandGroup>
            )}
            {hasModels && (
              <ModelGroups
                groupedModels={filteredGroupedModels}
                hasPremium={hasPremium}
                onAddProvider={() => {
                  closePopover();
                  onAddProvider?.();
                }}
                onSelectModel={(uri, requiresPremium, modelName) => {
                  if (requiresPremium && autoModel) {
                    toast.info("Model requires paid plan", {
                      action: {
                        label: "Upgrade",
                        onClick: () => {
                          void navigate({ to: "/get-lifetime" });
                        },
                      },
                      description: `${modelName} is available with a paid ${APP_NAME} plan.`,
                      dismissible: true,
                      duration: 7000,
                      icon: <AppIconGlyph className="size-4 text-brand-400" />,
                    });
                  } else {
                    onValueChange(uri);
                  }
                  closePopover();
                }}
                selectedModel={selectedModel}
              />
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AutoModeSwitch({
  autoModel,
  checked,
  isInvalidOurModel,
  onCheckedChange,
}: {
  autoModel?: AIGatewayModel.Type;
  checked: boolean;
  isInvalidOurModel: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const navigate = useNavigate();

  if (!autoModel) {
    return null;
  }

  if (isInvalidOurModel && !checked) {
    return (
      <div
        className="flex flex-col gap-2 px-4 py-3"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex items-start gap-1.5">
          <WarningIcon className="mt-0.5 size-3 shrink-0 text-destructive/70" />
          <span className="text-xs text-muted-foreground">
            Your selected model is not available without a paid plan.
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={(e) => {
              e.stopPropagation();
              onCheckedChange(true);
            }}
            size="sm"
            variant="outline"
          >
            Switch to Auto
          </Button>
          <Button
            className="flex-1"
            onClick={(e) => {
              e.stopPropagation();
              void navigate({ to: "/get-lifetime" });
            }}
            size="sm"
            variant="default"
          >
            Upgrade
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-1 px-4 py-3"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Auto</span>
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </div>
      <span className="text-xs text-muted-foreground">
        Selects the best model for your task
      </span>
    </div>
  );
}

function ErrorsGroup({
  errors,
  hasOurProviderError,
}: {
  errors: NonNullable<RPCOutput["gateway"]["models"]["list"]["errors"]>;
  hasOurProviderError: boolean;
}) {
  return (
    <CommandGroup
      heading={
        <div className="flex w-full items-center justify-between">
          <span>Errors</span>
          <Button
            className="h-6 px-2 text-xs"
            onClick={() => {
              if (hasOurProviderError) {
                void rpcClient.preferences.openSettingsWindow.call({
                  tab: "General",
                });
              } else {
                void rpcClient.preferences.openSettingsWindow.call({
                  showNewProviderDialog: false,
                  tab: "Providers",
                });
              }
            }}
            size="sm"
            variant="outline"
          >
            {hasOurProviderError ? "Check account" : "Edit providers"}
          </Button>
        </div>
      }
    >
      {errors.map((error) => (
        <CommandItem
          className="flex cursor-default items-center py-2 data-disabled:opacity-80!"
          disabled
          key={error.config.id}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-1 text-xs">
              <AIProviderIcon
                className="size-3 shrink-0"
                type={error.config.type}
              />
              <span className="text-muted-foreground">
                {error.config.displayName}
              </span>
            </div>
            <span className="line-clamp-2 text-xs wrap-break-word">
              {error.message}
            </span>
          </div>
          <WarningCircleIcon className="mt-0.5 ml-2 size-4 shrink-0 self-start text-destructive" />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function ModelGroups({
  groupedModels,
  hasPremium,
  onAddProvider,
  onSelectModel,
  selectedModel,
}: {
  groupedModels: Record<string, MatchedModel[]>;
  hasPremium: boolean;
  onAddProvider: () => void;
  onSelectModel: (
    uri: AIGatewayModelURI.Type,
    requiresPremium: boolean,
    modelName: string,
  ) => void;
  selectedModel?: AIGatewayModel.Type;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<VirtualRow[]>(() => {
    const flat: VirtualRow[] = [];
    for (const [groupName, matchedGroup] of Object.entries(groupedModels)) {
      if (matchedGroup.length === 0) {
        continue;
      }
      flat.push({ groupName, type: "header" });
      for (const matched of matchedGroup) {
        flat.push({
          matched,
          requiresPremium:
            matched.model.tags.includes("premium") && !hasPremium,
          type: "item",
        });
      }
    }
    return flat;
  }, [groupedModels, hasPremium]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (i) => (rows[i]?.type === "header" ? 28 : 56),
    getScrollElement: () => parentRef.current,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 8,
  });

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <p className="text-sm text-muted-foreground">No matching models</p>
        <Button onClick={onAddProvider} size="sm" variant="outline">
          <PlusIcon className="mr-2 size-4" />
          Add an AI provider
        </Button>
        <p className="max-w-64 text-center text-xs text-muted-foreground">
          The model you&apos;re looking for might be available from a different
          provider
        </p>
      </div>
    );
  }

  return (
    <div
      className="overflow-y-auto"
      ref={parentRef}
      style={{ maxHeight: "328px" }}
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const row = rows[virtualItem.index];
          if (!row) {
            return null;
          }

          if (row.type === "header") {
            return (
              <div
                className="absolute top-0 left-0 w-full px-2 py-1.5 text-xs font-medium text-muted-foreground"
                data-index={virtualItem.index}
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {row.groupName}
              </div>
            );
          }

          const { matched, requiresPremium } = row;
          const { model, nameRanges, providerRanges } = matched;
          return (
            <div
              className="absolute top-0 left-0 w-full"
              data-index={virtualItem.index}
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              <CommandItem
                className="flex w-full items-center justify-between px-2 py-2"
                onSelect={() => {
                  onSelectModel(model.uri, requiresPremium, model.name);
                }}
                value={model.uri}
              >
                <div className="flex items-center">
                  <CheckIcon
                    className={cn(
                      "mr-2 size-4 shrink-0",
                      selectedModel?.uri === model.uri
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  <div className="flex flex-col gap-1">
                    <span className="text-sm">
                      <FuzzyHighlight ranges={nameRanges} text={model.name} />
                    </span>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <AIProviderIcon
                        className="size-3 shrink-0"
                        type={model.params.provider}
                      />
                      <FuzzyHighlight
                        ranges={providerRanges}
                        text={model.providerName}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-1 ml-2 flex gap-1 self-start">
                  <ModelBadges hasPremium={hasPremium} model={model} />
                </div>
              </CommandItem>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NoProvidersMessage({ onAddProvider }: { onAddProvider: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 border-t py-6">
      <p className="text-sm text-muted-foreground">
        Connect a provider to use {APP_NAME}
      </p>
      <Button onClick={onAddProvider} size="sm" variant="outline">
        <PlusIcon className="mr-2 size-4" />
        Add an AI provider
      </Button>
    </div>
  );
}
