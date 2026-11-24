import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { TIME_RANGES, type TimeRangeId } from "@/client/lib/browsing-data";
import { useId } from "react";

/** How far back a Clear dialog reaches. */
export function TimeRangeField({
  onChange,
  range,
}: {
  onChange: (range: TimeRangeId) => void;
  range: TimeRangeId;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm" htmlFor={id}>
        Time range
      </label>
      <Select
        onValueChange={(value) => {
          const option = TIME_RANGES.find((each) => each.id === value);
          if (option) {
            onChange(option.id);
          }
        }}
        value={range}
      >
        <SelectTrigger className="w-40" id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end" position="popper">
          {TIME_RANGES.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** One thing a Clear dialog clears, with how much of it there is. */
export function ClearBox({
  checked,
  detail,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  /** How much there is, once it is known. */
  detail: string | undefined;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="flex cursor-default items-start gap-3 rounded-lg px-1 py-2">
      <Checkbox
        aria-describedby={`${id}-detail`}
        aria-labelledby={`${id}-label`}
        checked={checked}
        className="mt-0.5"
        onCheckedChange={(value) => {
          onCheckedChange(value === true);
        }}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm" id={`${id}-label`}>
          {label}
        </span>
        <span
          className="min-h-4 text-xs text-muted-foreground"
          id={`${id}-detail`}
        >
          {detail}
        </span>
      </span>
    </label>
  );
}
