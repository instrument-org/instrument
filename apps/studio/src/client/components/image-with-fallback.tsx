import {
  type ImageArrival,
  useImageArrival,
} from "@/client/hooks/use-image-arrival";
import { cn } from "@/client/lib/utils";
import { useState } from "react";

import { FileIcon } from "./file-icon";

export function ImageWithFallback({
  alt,
  arrival: arrivalKind = "surface",
  className,
  fallback,
  fallbackClassName,
  filename,
  onError,
  onLoad,
  showCheckerboard = false,
  src,
  ...props
}: Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "alt" | "onError" | "src"
> & {
  alt: string;
  /** How the image enters once it loads; see {@link useImageArrival}. */
  arrival?: ImageArrival;
  className?: string;
  fallback?: React.ReactNode;
  fallbackClassName?: string;
  filename: string;
  onError?: () => void;
  showCheckerboard?: boolean;
  src: string;
}) {
  const [errorSrc, setErrorSrc] = useState<null | string>(null);
  const arrival = useImageArrival(src, arrivalKind);
  const hasError = errorSrc === src;

  const handleError = () => {
    setErrorSrc(src);
    onError?.();
  };

  if (hasError) {
    if (fallback) {
      return <>{fallback}</>;
    }

    return (
      <div
        className={cn("flex items-center justify-center", fallbackClassName)}
      >
        <FileIcon
          className="size-6 text-muted-foreground"
          filename={filename}
        />
      </div>
    );
  }

  return (
    <img
      {...props}
      alt={alt}
      className={cn(
        className,
        showCheckerboard && "checkerboard",
        arrival.className,
      )}
      onError={handleError}
      onLoad={(event) => {
        arrival.onLoad();
        onLoad?.(event);
      }}
      src={src}
    />
  );
}
