import {
  closeFilePreviewAtom,
  filePreviewAtom,
} from "@/client/atoms/file-preview";
import { getFileType } from "@/client/lib/get-file-type";
import { formatBytes } from "@instrument-org/workspace/client";
import { XIcon } from "@phosphor-icons/react/X";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRouter } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";

import { FileIcon } from "./file-icon";
import { FilePreviewFallback } from "./file-preview-fallback";
import { ImageViewer } from "./image-viewer";
import { Button } from "./ui/button";
import { DialogOverlay } from "./ui/dialog";

export function FilePreviewModal() {
  const state = useAtomValue(filePreviewAtom);
  const closePreview = useSetAtom(closeFilePreviewAtom);
  const router = useRouter();
  // Remembered against the url rather than as a bare flag, so the fallback
  // card belongs to the file that actually failed instead of standing in front
  // of every file opened after it.
  const [failedUrl, setFailedUrl] = useState<null | string>(null);

  const { file } = state;

  useEffect(() => {
    const unsubscribe = router.subscribe("onBeforeLoad", () => {
      if (state.isOpen) {
        closePreview();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [router, state.isOpen, closePreview]);

  if (!file?.url) {
    return null;
  }

  const fileType = getFileType(file);
  const hasExtension = file.filename.includes(".");
  const isImage = fileType === "image" || (!file.mimeType && !hasExtension);

  return (
    <DialogPrimitive.Root
      onOpenChange={(open) => {
        if (!open) {
          closePreview();
        }
      }}
      open={state.isOpen}
    >
      <DialogPrimitive.Portal>
        <DialogOverlay className="bg-black/80" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 flex items-center justify-center data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
          <DialogPrimitive.Title className="sr-only">
            {file.filename}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            File preview
          </DialogPrimitive.Description>
          <div
            className="relative flex size-full flex-col"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                closePreview();
              }
            }}
          >
            <div className="absolute top-4 right-4 left-4 z-10 flex items-center justify-center gap-2 text-white">
              <div className="flex items-center gap-2 rounded-sm bg-black/50 px-3 py-1.5">
                <FileIcon
                  className="size-4 shrink-0"
                  filename={file.filename}
                />
                <span className="truncate text-xs">{file.filename}</span>
                {/* eslint-disable-next-line unicorn/explicit-length-check */}
                {file.size && (
                  <span className="text-xs text-white/60">
                    {formatBytes(file.size)}
                  </span>
                )}
              </div>
              <div className="absolute right-0 flex items-center gap-1">
                <Button
                  className="text-white hover:bg-white/10"
                  onClick={closePreview}
                  size="sm"
                  variant="ghost"
                >
                  <XIcon className="size-4" />
                </Button>
              </div>
            </div>

            <div
              className="relative flex min-h-0 flex-1 items-center justify-center p-16"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  closePreview();
                }
              }}
            >
              <div
                className="flex size-full items-center justify-center"
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    closePreview();
                  }
                }}
              >
                {isImage && failedUrl !== file.url ? (
                  /* Full-window is where the detail in a large image or
                     diagram is actually read, and nothing here scrolls, so the
                     wheel, a drag, and a pinch can all mean what they usually
                     mean. Keyed by url so each file opens back at fit scale
                     rather than inheriting the last one's zoom. */
                  <ImageViewer
                    filename={file.filename}
                    key={file.url}
                    onError={() => {
                      setFailedUrl(file.url);
                    }}
                    url={file.url}
                  />
                ) : isImage ? (
                  <FilePreviewFallback
                    fallbackExtension="jpg"
                    filename={file.filename}
                  />
                ) : (
                  <FilePreviewFallback filename={file.filename} />
                )}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
