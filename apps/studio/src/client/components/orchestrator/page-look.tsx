import { Spinner } from "@/client/components/ui/spinner";

import { usePagePicture } from "./page-picture";

/**
 * The page as a browser draws it, whole, fitted to the panel: a picture of
 * the page rather than the page, so Space is a look and not a load.
 */
export function PageLook({ hostPath }: { hostPath: string }) {
  const picture = usePagePicture({ hostPath });
  return (
    <div className="flex h-full items-center justify-center p-3">
      {picture.isError ? (
        <p className="text-sm text-muted-foreground">
          The page could not be drawn
        </p>
      ) : picture.data ? (
        <img
          alt=""
          className="max-h-full max-w-full rounded-sm object-contain shadow-sm ring-1 ring-border"
          draggable={false}
          src={picture.data.dataUrl}
        />
      ) : (
        <Spinner className="size-5" />
      )}
    </div>
  );
}
