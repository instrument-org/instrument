import * as React from "react";

type ThumbnailFile = {
  name: string;
  type: string;
};
export type FileThumbnailProps = {
  file: ThumbnailFile | File;
  className?: string;
  previewAspectRatio?: number;
  previewClassName?: string;
  previewContent?: React.ReactNode;
  previewImageUrl?: string | null;
  isLoading?: boolean;
  hasError?: boolean;
  style?: React.CSSProperties;
};
function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
// Preview URLs that have completed a reveal this session. View/tab switches
// remount thumbnails; URLs in this set render instantly instead of replaying
// the blur-in, so only an image's first load animates.
const revealedPreviewImageUrls = new Set<string>();
// The shape of every preview image that has loaded this session, width over
// height by URL. A file's own shape is not in its manifest, so the box a
// preview is drawn in starts as a page and takes the image's shape once the
// image has said what it is.
const naturalAspectRatios = new Map<string, number>();
const naturalAspectRatioListeners = new Set<() => void>();
function subscribeToNaturalAspectRatios(listener: () => void) {
  naturalAspectRatioListeners.add(listener);
  return () => {
    naturalAspectRatioListeners.delete(listener);
  };
}
function recordNaturalAspectRatio(imageUrl: string, image: HTMLImageElement) {
  const ratio = image.naturalWidth / image.naturalHeight;
  if (naturalAspectRatios.get(imageUrl) === ratio) return;
  naturalAspectRatios.set(imageUrl, ratio);
  for (const listener of naturalAspectRatioListeners) listener();
}
/**
 * The shape a preview image turned out to have, width over height, once it
 * has loaded anywhere on the page; undefined until then, or for no URL.
 */
export function useNaturalAspectRatio(
  previewImageUrl: string | null | undefined,
) {
  return React.useSyncExternalStore(subscribeToNaturalAspectRatios, () =>
    previewImageUrl ? naturalAspectRatios.get(previewImageUrl) : undefined,
  );
}
function FileThumbnailLoadingOverlay() {
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
export function FileThumbnail({
  className,
  previewAspectRatio,
  previewClassName,
  previewContent,
  previewImageUrl,
  isLoading = false,
  hasError = false,
  style,
}: FileThumbnailProps) {
  const imageRef = React.useRef<HTMLImageElement | null>(null);
  const revealFrameRef = React.useRef<number | null>(null);
  const [loadedPreviewImageUrl, setLoadedPreviewImageUrl] = React.useState<
    string | null
  >(() =>
    previewImageUrl && revealedPreviewImageUrls.has(previewImageUrl)
      ? previewImageUrl
      : null,
  );
  const [failedPreviewImageUrl, setFailedPreviewImageUrl] = React.useState<
    string | null
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
    (image: HTMLImageElement, imageUrl: string | null | undefined) => {
      if (!imageUrl) return;
      const didLoad = image.naturalWidth > 0 && image.naturalHeight > 0;
      setFailedPreviewImageUrl(didLoad ? null : imageUrl);
      if (didLoad) {
        // Before the reveal, so the box takes the image's shape and the
        // image fades into it, rather than fading in and then reshaping.
        recordNaturalAspectRatio(imageUrl, image);
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
      style={style}
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
          // eslint-disable-next-line @next/next/no-img-element -- Preview URLs can be transient object or presigned URLs outside Next image optimization.
          <img
            ref={imageRef}
            src={previewImageUrl}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
            className={cx(
              "absolute inset-0 block size-full object-cover transition-[opacity,filter] duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              showLoading ? "opacity-0 blur-sm" : "blur-0 opacity-100",
            )}
            onLoad={(event) => {
              markImageLoaded(event.currentTarget, previewImageUrl);
            }}
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
          <div className="absolute inset-0 bg-muted" aria-hidden="true" />
        ) : null}
      </div>
    </div>
  );
}
