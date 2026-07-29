import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { type TaskFileOpenControl } from "@/client/hooks/use-task-file-open-control";
import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react";
import { type ComponentProps } from "react";

import { OpenTargetIcon } from "./open-target-icon";
import { OpenWithDropdown } from "./open-with-menu";
import { Button, type ButtonVariant } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";

type FileRef = Pick<TaskFileViewerFile, "filePath" | "taskId">;

export function OpenTaskFileButton({
  className,
  control,
  dropdownClassName,
  file,
  iconClassName,
  labelClassName,
  onClick,
  size = "sm",
  variant = "default",
}: {
  className?: string;
  control: TaskFileOpenControl;
  dropdownClassName?: string;
  file: FileRef | undefined;
  iconClassName?: string;
  labelClassName?: string;
  onClick?: ComponentProps<typeof Button>["onClick"];
  size?: ComponentProps<typeof Button>["size"];
  variant?: ButtonVariant;
}) {
  if (!file || !control.showOpen) {
    return null;
  }

  const handlePrimaryClick: ComponentProps<typeof Button>["onClick"] = (
    event,
  ) => {
    onClick?.(event);
    control.open();
  };

  return (
    <ButtonGroup aria-label={control.openLabel} className="max-w-full">
      <Button
        aria-label={control.openLabel}
        className={cn(
          "min-w-0 shrink",
          className,
          control.showOpenWithDropdown && "rounded-r-none",
        )}
        onClick={handlePrimaryClick}
        size={size}
        type="button"
        variant={variant}
      >
        <OpenTargetIcon className={iconClassName} file={file} />
        <span className={cn("min-w-0 truncate", labelClassName)}>
          {control.openLabel}
        </span>
      </Button>
      {control.showOpenWithDropdown && (
        <OpenWithDropdown file={file}>
          <Button
            aria-label="Open with"
            // Both segments share one fill and there is no divider, so the gap
            // the eye reads before the caret is this button's leading padding
            // plus the primary button's trailing padding. Trimming the leading
            // padding offsets that, while the trailing padding stays equal to
            // the group's leading inset. An icon size keeps a caller's height
            // override from dragging in `has-[>svg]:px-*`, whose `:has()`
            // specificity would beat these paddings.
            className={cn(
              dropdownClassName,
              "w-auto rounded-l-none pr-2 pl-1.5",
            )}
            onClick={onClick}
            size="icon-sm"
            type="button"
            variant={variant}
          >
            <CaretDownIcon className="size-3" />
          </Button>
        </OpenWithDropdown>
      )}
    </ButtonGroup>
  );
}
