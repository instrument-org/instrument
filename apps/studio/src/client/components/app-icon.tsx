import { IconMap } from "@/client/components/tab-icons";
import { type TabIconName } from "@instrument-org/shared/icons";
import { tv, type VariantProps } from "tailwind-variants";

const projectIconVariants = tv({
  base: "shrink-0 transition-colors",
  defaultVariants: {
    isSelected: false,
    size: "sm",
  },
  variants: {
    isSelected: {
      false: "text-muted-foreground",
      true: "text-foreground",
    },
    size: {
      lg: "size-7",
      md: "size-5",
      sm: "mx-0.5 size-4",
      xl: "size-9",
      xs: "size-3",
    },
  },
});

export function ProjectIcon({
  isSelected,
  name,
  size,
}: VariantProps<typeof projectIconVariants> & {
  name?: TabIconName;
}) {
  const IconComponent = name ? IconMap[name] : undefined;

  if (!IconComponent) {
    return null;
  }

  return (
    <IconComponent className={projectIconVariants({ isSelected, size })} />
  );
}
