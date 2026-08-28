import { CopyIcon } from "@phosphor-icons/react/Copy";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { toolbarClassName } from "../ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { type TableCopyFormat } from "./table-clipboard";
import { TABLE_COPY_FORMATS } from "./table-copy-formats";

/** One menu item's two lines, so a context menu and a dropdown read alike. */
export function TableCopyFormatLabel({
  hint,
  label,
}: {
  hint: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span>{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

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
      <DropdownMenuContent align="end" className="max-w-72">
        <DropdownMenuLabel>Copy table</DropdownMenuLabel>
        {TABLE_COPY_FORMATS.map(({ format, hint, label }) => (
          <DropdownMenuItem
            key={format}
            onSelect={() => {
              onCopy(format);
            }}
          >
            <TableCopyFormatLabel hint={hint} label={label} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
