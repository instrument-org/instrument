import { ErrorDialog } from "@videojs/react";

import { Button } from "@/client/components/videojs/ui/button";
import { cn } from "@/client/lib/resolve-class-name";

export function AudioErrorDialog() {
  return (
    <ErrorDialog.Root>
      <ErrorDialog.Backdrop className={"hidden"} />
      <ErrorDialog.Popup
        className={cn(
          "absolute inset-0 z-50 flex h-full max-h-none w-full translate-none flex-row items-center rounded-media-pill py-0 outline-hidden not-data-open:hidden",
          "bg-media-background text-media-controls-foreground backdrop-filter-media-dialog",
          "transition-[opacity,filter] duration-media-slower ease-out",
          "media-transitioning:opacity-0 media-transitioning:blur-media-hidden-popup",
          "gap-3 px-5",
        )}
      >
        <div
          className={
            "flex min-h-0 flex-1 flex-row items-center gap-2 overflow-visible"
          }
        >
          <ErrorDialog.Title
            className={"m-0 text-media leading-tight font-semibold"}
          />
          <ErrorDialog.Description className={"m-0 wrap-anywhere opacity-70"} />
        </div>
        <div className={"flex shrink-0 gap-2"}>
          <ErrorDialog.Close
            render={<Button />}
            className={
              "h-media-control w-auto flex-none bg-media-primary! px-3 font-medium text-media-primary-foreground!"
            }
          />
        </div>
      </ErrorDialog.Popup>
    </ErrorDialog.Root>
  );
}
