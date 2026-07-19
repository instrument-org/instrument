// Vendored from Extend UI (https://ui.extend.ai), MIT licensed.
// Local changes: import paths only.

import * as React from "react";

export type FileThumbnailProps = {
  className?: string;
  file: File | ThumbnailFile;
  hasError?: boolean;
  isLoading?: boolean;
  previewAspectRatio?: number;
  previewClassName?: string;
  previewContent?: React.ReactNode;
  previewImageUrl?: null | string;
};

export type ThumbnailFile = {
  name: string;
  type: string;
};

function cx(...classes: Array<false | null | string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

// Preview URLs that have completed a reveal this session. View/tab switches
// remount thumbnails; URLs in this set render instantly instead of replaying
// the blur-in, so only an image's first load animates.
const revealedPreviewImageUrls = new Set<string>();

export function FileThumbnail({
  className,
  hasError = false,
  isLoading = false,
  previewAspectRatio,
  previewClassName,
  previewContent,
  previewImageUrl,
}: FileThumbnailProps) {
  const imageRef = React.useRef<HTMLImageElement | null>(null);
  const revealFrameRef = React.useRef<null | number>(null);
  const [loadedPreviewImageUrl, setLoadedPreviewImageUrl] = React.useState<
    null | string
  >(() =>
    previewImageUrl && revealedPreviewImageUrls.has(previewImageUrl)
      ? previewImageUrl
      : null,
  );
  const [failedPreviewImageUrl, setFailedPreviewImageUrl] = React.useState<
    null | string
  >(null);
  const imageFailed = Boolean(
    previewImageUrl && failedPreviewImageUrl === previewImageUrl,
  );
  const isImageLoading = Boolean(
    previewImageUrl &&
    loadedPreviewImageUrl !== previewImageUrl &&
    !imageFailed &&
    !revealedPreviewImageUrls.has(previewImageUrl),
  );
  const showLoading = isLoading || isImageLoading;
  const hasPreviewContent = Boolean(previewContent);
  const showFallback =
    !showLoading &&
    (hasError || imageFailed || (!previewImageUrl && !hasPreviewContent));
  const cancelImageReveal = React.useCallback(() => {
    if (revealFrameRef.current === null) return;

    window.cancelAnimationFrame(revealFrameRef.current);
    revealFrameRef.current = null;
  }, []);
  const markImageLoaded = React.useCallback(
    (image: HTMLImageElement, imageUrl: null | string | undefined) => {
      if (!imageUrl) return;

      const didLoad = image.naturalWidth > 0 && image.naturalHeight > 0;

      setFailedPreviewImageUrl(didLoad ? null : imageUrl);
      if (didLoad) {
        revealedPreviewImageUrls.add(imageUrl);
        cancelImageReveal();
        revealFrameRef.current = window.requestAnimationFrame(() => {
          revealFrameRef.current = window.requestAnimationFrame(() => {
            setLoadedPreviewImageUrl(imageUrl);
            revealFrameRef.current = null;
          });
        });
      }
    },
    [cancelImageReveal],
  );

  React.useEffect(() => {
    cancelImageReveal();
  }, [cancelImageReveal, previewImageUrl]);

  React.useEffect(() => cancelImageReveal, [cancelImageReveal]);

  React.useEffect(() => {
    const image = imageRef.current;

    if (!image || !previewImageUrl) return;

    if (image.complete) {
      markImageLoaded(image, previewImageUrl);
    }
  }, [markImageLoaded, previewImageUrl]);

  return (
    <div
      className={cx(
        "group overflow-hidden rounded-lg border bg-background text-foreground",
        className,
      )}
    >
      <div
        className={cx(
          "relative aspect-square overflow-hidden bg-muted [contain:layout_paint]",
          previewClassName,
        )}
        style={
          previewAspectRatio
            ? { aspectRatio: String(previewAspectRatio) }
            : undefined
        }
      >
        {previewImageUrl ? (
          <img
            alt=""
            className={cx(
              "absolute inset-0 block size-full object-cover transition-[opacity,filter] duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              showLoading ? "opacity-0 blur-sm" : "blur-0 opacity-100",
            )}
            decoding="async"
            draggable={false}
            loading="lazy"
            onError={() => {
              if (previewImageUrl) {
                revealedPreviewImageUrls.delete(previewImageUrl);
                cancelImageReveal();
                setFailedPreviewImageUrl(previewImageUrl);
                setLoadedPreviewImageUrl((currentUrl) =>
                  currentUrl === previewImageUrl ? null : currentUrl,
                );
              }
            }}
            onLoad={(event) => {
              markImageLoaded(event.currentTarget, previewImageUrl);
            }}
            ref={imageRef}
            src={previewImageUrl}
          />
        ) : null}
        {previewContent ? (
          <div
            className={cx(
              "absolute inset-0 size-full transition-[opacity,filter] duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              showLoading ? "opacity-0 blur-sm" : "blur-0 opacity-100",
            )}
          >
            {previewContent}
          </div>
        ) : null}
        {showLoading ? <FileThumbnailLoadingOverlay /> : null}
        {showFallback ? (
          <div aria-hidden="true" className="absolute inset-0 bg-muted" />
        ) : null}
      </div>
    </div>
  );
}

export function FileThumbnailLoadingOverlay() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 z-10 overflow-hidden bg-muted"
    >
      <div className="absolute inset-0 bg-muted" />
      <div className="absolute inset-0 animate-pulse bg-background/55 motion-reduce:animate-none" />
    </div>
  );
}
