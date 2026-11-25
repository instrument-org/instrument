import { makeChoice, readChoice } from "@/client/lib/model-choice";
import { cn } from "@/client/lib/utils";
import {
  type AIGatewayModel,
  type ModelChoice,
} from "@instrument-org/ai-gateway/client";
import { type ReactElement, type SyntheticEvent, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Switch } from "./ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** A menu of choices stays up, so a level and Fast are one visit. */
function stayOpen(event: Event) {
  event.preventDefault();
}

function stop(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * How hard a model thinks and whether it runs fast. `children` is the button
 * it opens from. Its events stop here, since React carries them out of the
 * menu to whatever the button sits in: a row that picks the model when
 * pressed, a list the arrow keys move in.
 */
export function ModelChoiceMenu({
  children,
  choice,
  model,
  onChange,
  onClosed,
  side,
  tooltip,
}: {
  children: ReactElement;
  choice: ModelChoice | undefined;
  model: AIGatewayModel.Type;
  onChange: (choice: ModelChoice | undefined) => void;
  /** Takes the focus once the menu has closed, in place of the button. */
  onClosed?: () => void;
  side: "bottom" | "top";
  tooltip: string;
}) {
  const [open, setOpen] = useState(false);
  const { choices } = model;
  if (!choices) {
    return null;
  }
  const { effort, fast } = readChoice(model, choice);
  const set = (next: { effort?: string | undefined; fast?: boolean }) => {
    onChange(makeChoice(model, { effort: effort?.id, fast, ...next }));
  };
  const name = model.name.trim();
  return (
    <span
      className="contents"
      onClick={stop}
      onKeyDown={stop}
      onPointerDown={stop}
      onPointerMove={stop}
      role="presentation"
    >
      <DropdownMenu onOpenChange={setOpen} open={open}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          aria-label="Effort and speed"
          className="min-w-52"
          onCloseAutoFocus={(event) => {
            if (onClosed) {
              event.preventDefault();
              onClosed();
            }
          }}
          onKeyDown={(event) => {
            // A level's tooltip would take the first Escape for itself.
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          side={side}
        >
          {choices.efforts.length > 0 && (
            <>
              <Level
                checked={effort === undefined}
                description={`What ${model.providerName} uses for ${name} unless you choose a level.`}
                label={
                  choices.defaultLabel
                    ? `Default (${choices.defaultLabel})`
                    : "Default"
                }
                onPick={() => {
                  set({ effort: undefined });
                }}
              />
              <DropdownMenuSeparator />
              {choices.efforts.map((level) => (
                <Level
                  checked={level.id === effort?.id}
                  description={level.description}
                  key={level.id}
                  label={level.label}
                  onPick={() => {
                    set({ effort: level.id });
                  }}
                />
              ))}
            </>
          )}
          {choices.fast && (
            <>
              {choices.efforts.length > 0 && <DropdownMenuSeparator />}
              <FastRow
                fast={choices.fast}
                isOn={fast}
                onToggle={() => {
                  set({ fast: !fast });
                }}
              />
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function Level({
  checked,
  description,
  label,
  onPick,
}: {
  checked: boolean;
  description: string | undefined;
  label: string;
  onPick: () => void;
}) {
  const item = (
    <DropdownMenuCheckboxItem
      checked={checked}
      onCheckedChange={onPick}
      onSelect={stayOpen}
    >
      {label}
    </DropdownMenuCheckboxItem>
  );
  return description ? (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>{item}</TooltipTrigger>
      <TooltipContent maxWidth="14rem" side="left">
        {description}
      </TooltipContent>
    </Tooltip>
  ) : (
    item
  );
}

function FastRow({
  fast,
  isOn,
  onToggle,
}: {
  fast: NonNullable<AIGatewayModel.Choices["fast"]>;
  isOn: boolean;
  onToggle: () => void;
}) {
  const isOff = fast.off !== undefined;
  const line = fast.off?.row ?? fast.note;
  return (
    <DropdownMenuItem
      aria-checked={isOn}
      // The reason it is off stays readable, so only its name and switch gray.
      className="justify-between gap-4 data-disabled:opacity-100"
      disabled={isOff}
      onSelect={(event) => {
        event.preventDefault();
        onToggle();
      }}
      role="menuitemcheckbox"
    >
      <span className="flex min-w-0 flex-col">
        <span className={cn(isOff && "opacity-50")}>Fast</span>
        {line && <span className="text-xs text-muted-foreground">{line}</span>}
      </span>
      <Switch
        aria-hidden
        checked={isOn}
        className="pointer-events-none"
        disabled={isOff}
        tabIndex={-1}
      />
    </DropdownMenuItem>
  );
}
