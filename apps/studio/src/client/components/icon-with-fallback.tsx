import { type ReactNode, useState } from "react";

// Renders a locally-hosted icon, falling back to `fallback` when there is no
// source or the image fails to load. Icons are served from an on-disk cache
// over the app protocol, so a URL can point at a file that was pruned or is
// unreadable; without an error path that would render a broken-image glyph.
export function IconWithFallback({
  className,
  fallback,
  src,
}: {
  className?: string;
  fallback: ReactNode;
  src: null | string;
}) {
  // Track the failed src rather than a boolean so the fallback clears itself
  // when a fresh (content-addressed) URL arrives after a failure.
  const [failedSrc, setFailedSrc] = useState<null | string>(null);

  if (!src || failedSrc === src) {
    return fallback;
  }

  return (
    <img
      alt=""
      className={className}
      draggable={false}
      onError={() => {
        setFailedSrc(src);
      }}
      src={src}
    />
  );
}
