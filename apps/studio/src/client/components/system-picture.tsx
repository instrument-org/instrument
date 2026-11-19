import { useTheme } from "@/client/components/theme-provider";
import { getComputerThumbnailUrl } from "@/client/lib/computer-file-url";
import { cn } from "@/client/lib/utils";
import { type ReactNode, useState } from "react";

/**
 * The picture the system makes of a file, as the Finder shows it, or
 * `fallback` where it has none.
 */
export function SystemPicture({
  className,
  fallback,
  hostPath,
}: {
  className?: string;
  fallback: ReactNode;
  hostPath: string;
}) {
  const { resolvedTheme } = useTheme();
  const picture = getComputerThumbnailUrl({
    hostPath,
    size: 512,
    theme: resolvedTheme,
  });
  const [failed, setFailed] = useState<string>();
  if (!picture || failed === picture) {
    return fallback;
  }
  return (
    <img
      alt=""
      className={cn("object-contain", className)}
      draggable={false}
      onError={() => {
        setFailed(picture);
      }}
      src={picture}
    />
  );
}
