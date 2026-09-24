import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";

/**
 * A new chat about the thing beside it, in the rail's New button's green and
 * with its mark, so it reads as the same door wherever it stands. The label
 * is dropped where the row has no room for it; the button keeps its name for
 * a screen reader either way.
 */
export function NewChatButton({
  className,
  labelClassName,
  onPress,
  title,
}: {
  className?: string;
  /** Where the label shows; always, when not given. */
  labelClassName?: string;
  onPress: () => void;
  /** What the chat will be about, for the pointer's tooltip. */
  title: string;
}) {
  return (
    <Button
      aria-label="New Chat"
      className={cn("h-7 gap-1.5 rounded-full px-2.5 text-xs", className)}
      onClick={onPress}
      size="sm"
      title={title}
      variant="brand"
    >
      <PencilSimpleIcon className="size-3.5" weight="bold" />
      <span className={cn("leading-none whitespace-nowrap", labelClassName)}>
        New Chat
      </span>
    </Button>
  );
}
