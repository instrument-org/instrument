import { providerMetadataAtom } from "@/client/atoms/provider-metadata";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Command,
  CommandEmpty,
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
import { captureClientEvent } from "@/client/lib/capture-client-event";
import { type ProviderMetadata } from "@instrument-org/ai-gateway/client";
import { type AIProviderType } from "@instrument-org/shared";
import { CaretDownIcon, StarIcon } from "@phosphor-icons/react";
import { useAtomValue } from "jotai";
import { useState } from "react";

import { AIProviderIcon } from "./ai-provider-icon";

const TAG_TO_LABEL: Record<ProviderMetadata["tags"][number], string> = {
  imageGeneration: "Image gen",
  recommended: "Recommended",
};

export function ProviderPicker({
  onSelect,
  selectedProvider,
}: {
  onSelect: (providerType: AIProviderType | undefined) => void;
  selectedProvider: AIProviderType | undefined;
}) {
  const [open, setOpen] = useState(false);
  const { sortedProviderMetadata } = useAtomValue(providerMetadataAtom);

  const handleSelect = (providerType: AIProviderType) => {
    captureClientEvent("provider.selected", {
      provider_type: providerType,
    });
    onSelect(providerType);
    setOpen(false);
  };

  const selectedProviderData = selectedProvider
    ? sortedProviderMetadata.find((p) => p.type === selectedProvider)
    : null;

  return (
    <Popover
      onOpenChange={(newOpen) => {
        if (newOpen) {
          captureClientEvent("provider.picker_opened");
        }
        setOpen(newOpen);
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          className="justify-between"
          role="combobox"
          type="button"
          variant="input-select"
        >
          <div className="flex items-center gap-2">
            {selectedProviderData ? (
              <>
                <AIProviderIcon
                  className="size-4"
                  type={selectedProviderData.type}
                />
                {selectedProviderData.name}
              </>
            ) : (
              <>Choose a provider</>
            )}
          </div>
          <CaretDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        // Radix `--radix-popover-*` vars are measured in already-zoomed rendered
        // pixels; PopoverContent then self-applies CSS `zoom` (useAppZoomStyle), so
        // dividing by `--content-zoom` cancels the double-count: the panel matches
        // the trigger width and stays within the available height (the list flexes
        // and scrolls) instead of overflowing off-screen at zoom > 1.
        className="flex max-h-[calc(var(--radix-popover-content-available-height)/var(--content-zoom))] w-[calc(var(--radix-popover-trigger-width)/var(--content-zoom))] flex-col overflow-hidden p-0"
        onWheel={(e) => {
          e.stopPropagation();
        }}
      >
        <Command>
          <CommandInput placeholder="Search providers..." />
          <CommandList className="max-h-none min-h-0 flex-1">
            <CommandEmpty>Error loading providers.</CommandEmpty>
            <CommandGroup>
              {sortedProviderMetadata
                .filter((provider) => provider.canAddManually)
                .map((provider) => {
                  return (
                    <CommandItem
                      key={provider.type}
                      onSelect={() => {
                        handleSelect(provider.type);
                      }}
                      value={provider.name}
                    >
                      <AIProviderIcon
                        className="mr-2 size-5 shrink-0"
                        type={provider.type}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-y-0.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="shrink-0 font-medium">
                            {provider.name}
                          </span>
                          {provider.tags
                            .filter((tag) => tag !== "recommended")
                            .map((tag) => (
                              <Badge
                                className="shrink-0 [*[data-selected=true]_&]:border-foreground/20"
                                key={tag}
                                variant="outline"
                              >
                                {TAG_TO_LABEL[tag]}
                              </Badge>
                            ))}
                        </div>
                        {provider.tags.includes("recommended") && (
                          <div className="flex items-center gap-x-1 text-xs text-brand-text">
                            <StarIcon
                              className="size-2.5 rotate-180 fill-brand-text"
                              weight="fill"
                            />
                            <span>Recommended</span>
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {provider.description}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
