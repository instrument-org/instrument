import { openSettings } from "@/client/atoms/settings-modal";
import { Button } from "@/client/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
import { Label } from "@/client/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Switch } from "@/client/components/ui/switch";
import {
  getGroupedModelsEntries,
  groupAndFilterModels,
} from "@/client/lib/group-models";
import { joinFuzzyFields } from "@/client/lib/join-fuzzy-fields";
import { cn } from "@/client/lib/utils";
import { type RPCOutput } from "@/client/rpc/client";
import {
  type AIGatewayModel,
  type AIGatewayModelURI,
  modelNameFromURI,
} from "@instrument-org/ai-gateway/client";
import { APP_NAME, OUR_MODELS } from "@instrument-org/shared";
import uFuzzy from "@leeoniya/ufuzzy";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const fuzzy = new uFuzzy({ intraMode: 1 });

import { captureClientEvent } from "@/client/lib/capture-client-event";

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
  /** The current selection, which the models list may no longer resolve. */
  modelURI?: AIGatewayModelURI.Type;
  onAddProvider?: () => void;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  onValueChange: (value: AIGatewayModelURI.Type) => void;
  placeholder?: string;
  selectedModel?: AIGatewayModel.Type;
}

type VirtualRow =
  | { groupName: string; type: "header" }
  | { matched: MatchedModel; type: "item" };

export function ModelPicker({
  className = "",
  disabled = false,
  errors,
  isError = false,
  isInvalidOurModel = false,
  isLoading = false,
  models,
  modelURI,
  onAddProvider,
  onClose,
  onOpenChange,
  onValueChange,
  placeholder = "Select a model",
  selectedModel,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const autoModel = models?.find((m) => m.providerId === OUR_MODELS.text.id);
  const modelsWithoutAuto = useMemo(
    () => models?.filter((m) => m.providerId !== OUR_MODELS.text.id) ?? [],
    [models],
  );
  const groupedModels = useMemo(
    () => groupAndFilterModels({ models: modelsWithoutAuto }),
    [modelsWithoutAuto],
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

  const closePopover = () => {
    setOpen(false);
    setSearchQuery("");
    onClose?.();
  };

  const hasModels = modelsWithoutAuto.length > 0;
  const hasErrors = !!errors?.length;
  const isSelectDisabled = disabled || isLoading || isError;
  const hasOurProviderError =
    errors?.some((error) => error.config.type === OUR_MODELS.providerType) ??
    false;

  const isAutoMode = selectedModel?.providerId === OUR_MODELS.text.id;

  const hideModelList = isAutoMode && !searchQuery;

  // A selection outlives the list it came from, so a model the list no longer
  // resolves still gets named and flagged rather than silently reading as an
  // empty picker.
  const unresolvedName =
    !selectedModel && modelURI ? modelNameFromURI(modelURI) : null;
  const isUnavailable = isInvalidOurModel || !!unresolvedName;
  const selectedName = selectedModel?.name.trim() ?? unresolvedName;
  // A restriction carries its own explanation; anything else unavailable is a
  // model no connected provider serves.
  const unavailableReason =
    selectedModel?.restricted?.message ??
    "No connected AI provider offers this model. Pick another one, or switch to Auto.";

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
          captureClientEvent("model_picker.opened");
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
          aria-label="Model"
          className={cn(
            "flex h-auto items-center justify-between gap-2 rounded-lg px-1.5! py-1 text-left",
            "text-gray-400 hover:text-gray-400 dark:text-gray-500 dark:hover:text-gray-500",
            "max-w-full",
            className,
          )}
          disabled={isSelectDisabled}
          role="combobox"
          size="sm"
          variant="ghost"
        >
          <div className="flex w-full min-w-0 items-center">
            {selectedName ? (
              <div className="flex min-w-0 items-center gap-2 text-xs leading-4 font-medium">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="shrink-0">
                      {selectedModel && !isUnavailable ? (
                        <AIProviderIcon
                          className="size-4"
                          type={selectedModel.params.provider}
                        />
                      ) : (
                        <WarningIcon className="size-4 text-muted-foreground/60" />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {selectedModel && !isUnavailable ? (
                      <p>{selectedModel.providerName}</p>
                    ) : (
                      <p>{unavailableReason}</p>
                    )}
                  </TooltipContent>
                </Tooltip>
                <span className="min-w-0 flex-1 truncate">{selectedName}</span>
              </div>
            ) : (
              <span className="text-xs leading-4 font-medium opacity-50">
                {placeholderText}
              </span>
            )}
          </div>
          <CaretDownIcon className="size-3 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command shouldFilter={false}>
          <AutoModeSwitch
            autoModel={autoModel}
            checked={isAutoMode}
            isUnavailable={isUnavailable}
            onCheckedChange={(checked) => {
              if (checked && autoModel) {
                onValueChange(autoModel.uri);
              } else {
                onValueChange("" as AIGatewayModelURI.Type);
              }
            }}
            selectedName={selectedName}
          />
          {autoModel && !hideModelList && <hr className="border-t" />}
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
                hasAutoModel={!!autoModel}
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
                onAddProvider={() => {
                  closePopover();
                  onAddProvider?.();
                }}
                onSelectModel={(model) => {
                  if (model.restricted) {
                    toast.info(`${model.name.trim()} is unavailable`, {
                      description: model.restricted.message,
                      dismissible: true,
                      duration: 7000,
                    });
                  } else {
                    captureClientEvent("model_picker.model_selected", {
                      modelId: model.canonicalId,
                      providerId: model.params.provider,
                    });
                    onValueChange(model.uri);
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
  isUnavailable,
  onCheckedChange,
  selectedName,
}: {
  autoModel?: AIGatewayModel.Type;
  checked: boolean;
  isUnavailable: boolean;
  onCheckedChange: (checked: boolean) => void;
  selectedName: null | string;
}) {
  const switchId = useId();

  if (!autoModel) {
    return null;
  }

  if (isUnavailable && !checked) {
    return (
      <div
        className="flex flex-col gap-2 px-4 py-3"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            {selectedName
              ? `${selectedName} is unavailable`
              : "Selected model is unavailable"}
          </span>
          <span className="text-xs text-muted-foreground">
            Switch to Auto, or pick another model below.
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
          >
            Switch to Auto
          </Button>
        </div>
      </div>
    );
  }

  return (
    // The whole row toggles, which is the point of it, and a `Label` is how a
    // row does that without claiming to be a control it is not: it was a `div`
    // with `role="button"` and no way to focus or press it, so it announced a
    // button that a keyboard could not reach and wrapped a switch in the
    // bargain. The switch is the control; the label is its hit area and its
    // name. Same shape as the row checkboxes in `tasks-data-table/columns.tsx`.
    <Label
      className="flex flex-col items-stretch gap-1 px-4 py-3 select-none hover:bg-accent"
      htmlFor={switchId}
      onClick={(e) => {
        // The label would otherwise activate the switch itself, on top of this.
        e.preventDefault();
        e.stopPropagation();
        onCheckedChange(!checked);
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Auto</span>
        <Switch
          checked={checked}
          className="pointer-events-none"
          id={switchId}
          onCheckedChange={onCheckedChange}
        />
      </div>
      <span className="text-xs font-normal text-muted-foreground">
        Selects the best model for your task
      </span>
    </Label>
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
                openSettings({ tab: "General" });
              } else {
                openSettings({
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
  onAddProvider,
  onSelectModel,
  selectedModel,
}: {
  groupedModels: Record<string, MatchedModel[]>;
  onAddProvider: () => void;
  onSelectModel: (model: AIGatewayModel.Type) => void;
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
        flat.push({ matched, type: "item" });
      }
    }
    return flat;
  }, [groupedModels]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    estimateSize: (i) => (rows[i]?.type === "header" ? 28 : 56),
    getScrollElement: () => parentRef.current,
    // `offsetHeight`, not `getBoundingClientRect()`: the picker sits inside CSS
    // `zoom`, where the rect is the on-screen height while the row offsets and
    // spacer height this feeds are layout px. Measuring the rect reports every
    // row as `zoom x` its own height, spacing the list out with gaps and
    // stretching the scroll range to match.
    measureElement: (el) => el.offsetHeight,
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
                className="absolute top-0 right-1 left-1 px-2 py-1.5 text-xs font-medium text-muted-foreground"
                data-index={virtualItem.index}
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {row.groupName}
              </div>
            );
          }

          const { matched } = row;
          const { model, nameRanges, providerRanges } = matched;
          return (
            <div
              className="absolute top-0 right-1 left-1"
              data-index={virtualItem.index}
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              <CommandItem
                className="flex w-full items-center justify-between px-2 py-2"
                onSelect={() => {
                  onSelectModel(model);
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
                  <ModelBadges model={model} />
                </div>
              </CommandItem>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NoProvidersMessage({
  hasAutoModel,
  onAddProvider,
}: {
  hasAutoModel: boolean;
  onAddProvider: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 py-6",
        !hasAutoModel && "border-t",
      )}
    >
      <p
        className={cn(
          "text-center text-muted-foreground",
          hasAutoModel ? "text-xs" : "max-w-64 text-sm",
        )}
      >
        {hasAutoModel
          ? `Add an AI provider to use other models`
          : `Connect a provider to use ${APP_NAME}`}
      </p>
      <Button onClick={onAddProvider} size="sm" variant="outline">
        <PlusIcon className="mr-2 size-4" />
        Add an AI provider
      </Button>
    </div>
  );
}
