import { XIcon } from "@phosphor-icons/react/X";

import { Button } from "./ui/button";

export function AttachmentRemoveButton({ onRemove }: { onRemove: () => void }) {
  return (
    <Button
      aria-label="Remove attachment"
      className="absolute -top-2 -right-2 size-5 rounded-full border border-border opacity-0 shadow-sm group-hover:opacity-100 focus-visible:opacity-100"
      onClick={onRemove}
      size="icon-sm"
      type="button"
      variant="secondary"
    >
      <XIcon className="size-3" />
    </Button>
  );
}
