import { RadioGroupItem } from "@/client/components/ui/radio-group";
import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

/**
 * One model to pick, inside a `RadioGroup`: the radio, the maker's mark, the
 * model's name, a quieter line beside it (the model line behind one of
 * Instrument's), and Recommended on the one setup suggests. The whole row
 * picks it.
 */
export function ModelRow({
  icon,
  id,
  isRecommended = false,
  isSelected,
  name,
  sub,
  value,
}: {
  icon: ReactNode;
  /** Unique in the page, for the label to point at its radio. */
  id: string;
  isRecommended?: boolean;
  isSelected: boolean;
  name: string;
  sub?: string;
  value: string;
}) {
  return (
    <label
      className={cn(
        "flex h-12 w-full shrink-0 items-center gap-3.5 rounded-xl px-4",
        isSelected
          ? "bg-brand-50 dark:bg-brand-900/60"
          : "hover:bg-muted/60",
      )}
      htmlFor={id}
    >
      <RadioGroupItem
        className="size-5 border-gray-400 data-[state=checked]:border-brand-600 data-[state=checked]:[&_svg]:size-2.5 data-[state=checked]:[&_svg]:fill-brand-600 dark:data-[state=checked]:border-brand-400 dark:data-[state=checked]:[&_svg]:fill-brand-400"
        id={id}
        value={value}
      />
      <span className="flex size-5 shrink-0 items-center justify-center [&>*]:size-5">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        <span className="truncate font-medium text-foreground">{name}</span>
        {sub && <span className="truncate text-gray-400">{sub}</span>}
        {isRecommended && (
          <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-200">
            Recommended
          </span>
        )}
      </span>
    </label>
  );
}

/** A group's heading in a long list of models: Suggested, or a maker's name. */
export function ModelGroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">
      {children}
    </p>
  );
}
