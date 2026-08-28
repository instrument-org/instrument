import { CopyIcon } from "@phosphor-icons/react/Copy";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { toolbarClassName } from "../ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { type TableCopyFormat } from "./table-clipboard";
import { TABLE_COPY_ALTERNATES } from "./table-copy-formats";

/**
 * The copy control a viewer toolbar carries. Its scope is the whole table, so
 * it is the only way to copy one without first dragging a selection across it.
 */
export function TableCopyMenu({
  onCopy,
}: {
  onCopy: (format: TableCopyFormat) => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Copy table"
              className={toolbarClassName({
                className: "size-7",
                pressed: false,
              })}
              size="icon-sm"
              variant="ghost"
            >
              <CopyIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Copy table</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            onCopy("table");
          }}
        >
          Copy table
        </DropdownMenuItem>
        {TABLE_COPY_ALTERNATES.map(({ format, label }) => (
          <DropdownMenuItem
            key={format}
            onSelect={() => {
              onCopy(format);
            }}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
