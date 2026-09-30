import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { APP_NAME } from "@instrument-org/shared";
import { type FolderAttachment } from "@instrument-org/workspace/client";
import { type Icon } from "@phosphor-icons/react";
import { LockIcon } from "@phosphor-icons/react/Lock";
import { ShieldWarningIcon } from "@phosphor-icons/react/ShieldWarning";
import { Fragment } from "react";

export interface FolderAccess {
  access: FolderAttachment.Access;
  path: string;
}

// Adding a folder is the user asking the agent to work in it, so it starts with
// the access that allows that. The icon, its tooltip and the per-folder control
// are what make the choice legible and reversible.
//
// Deliberately the opposite of the schema's default, which is what an
// attachment carrying no access at all resolves to: that one is about folders
// stored before the choice existed, and has to preserve the posture they were
// attached under. Anything picked here states its access explicitly.
export const DEFAULT_FOLDER_ACCESS: FolderAttachment.Access = "read-write";

const ACCESS_LABELS: Record<FolderAttachment.Access, string> = {
  "read-only": "Read-only",
  "read-write": "Full access",
};

const ACCESS_ICONS: Record<FolderAttachment.Access, Icon> = {
  "read-only": LockIcon,
  "read-write": ShieldWarningIcon,
};

// Full access is stated in one place and shown the same way everywhere it
// applies: the shield, and this sentence on hovering it. Fixed rather than
// counted, because it describes the grant rather than the list it is read
// against.
const FULL_ACCESS_WARNING = `${APP_NAME} will be able to read and write the contents of these folders.`;

// Full access first: it is what a folder is attached with, so the list opens
// with the current choice at the top rather than the way out of it.
const ACCESS_ORDER: FolderAttachment.Access[] = ["read-write", "read-only"];

/**
 * What a folder was granted, and the way to change it.
 *
 * The trigger states the access in an icon and a word; hovering it while the
 * agent can write says what that means. Shared by every surface that grants a
 * folder so the same posture never reads two ways.
 */
export function FolderAccessControl({
  access,
  className,
  folderName,
  onChange,
}: {
  access: FolderAttachment.Access;
  className?: string;
  folderName: string;
  onChange: (access: FolderAttachment.Access) => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`Access for ${folderName}`}
              className={cn(
                "h-7 gap-1.5 border-border px-2 text-xs",
                className,
              )}
              variant="outline"
            >
              <FolderAccessIcon access={access} />
              {ACCESS_LABELS[access]}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {/* Below, so what it says about the folder does not cover the prompt
            the folder was attached to. */}
        {access === "read-write" && (
          <TooltipContent side="bottom">{FULL_ACCESS_WARNING}</TooltipContent>
        )}
      </Tooltip>
      <DropdownMenuContent align="end">
        {ACCESS_ORDER.map((value) => {
          const item = (
            <DropdownMenuCheckboxItem
              checked={access === value}
              // The checked row carries the emphasis, so the two read as a
              // current choice and an alternative rather than a pair of options.
              className="data-[state=checked]:text-foreground"
              onSelect={() => {
                onChange(value);
              }}
            >
              <FolderAccessIcon access={value} />
              {ACCESS_LABELS[value]}
            </DropdownMenuCheckboxItem>
          );

          if (value !== "read-write") {
            return <Fragment key={value}>{item}</Fragment>;
          }

          // The row is where the choice is actually made, so what it means has
          // to be readable from here too: whoever opened this menu to find out
          // what full access is should not have to close it again to be told.
          // Beside the menu rather than over it, so the other option stays
          // visible while this one is being read.
          return (
            <Tooltip key={value}>
              <TooltipTrigger asChild>{item}</TooltipTrigger>
              <TooltipContent side="right">
                {FULL_ACCESS_WARNING}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The shield or the lock, at the size every surface shows it. */
function FolderAccessIcon({
  access,
  className,
}: {
  access: FolderAttachment.Access;
  className?: string;
}) {
  const Icon = ACCESS_ICONS[access];

  return <Icon className={cn("size-4", className)} />;
}
