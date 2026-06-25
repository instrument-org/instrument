import { Input } from "@/client/components/ui/input";
import { type InlineRenameInputProps } from "@/client/hooks/use-inline-rename";

// h-9 matches sidebar row height so swapping in/out doesn't shift layout.
export function InlineRenameInput({
  inputProps,
}: {
  inputProps: InlineRenameInputProps;
}) {
  return (
    <div className="flex h-9 items-center gap-2 px-2">
      <Input className="-ml-1 h-7 pl-1 text-sm" {...inputProps} />
    </div>
  );
}
